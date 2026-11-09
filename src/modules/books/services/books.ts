import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/connection";
import { bookReadingLogs, books, userBooks } from "@/db/schema";
import { CEFR_LEVELS, CEFR_LEVEL_LABELS, isCefrLevel, type CefrLevel } from "@/modules/curriculum/domain/cefr";
import { learnerInputLevel } from "@/modules/materials/services/materials";

/**
 * Bookshelf and book recommendations (extensive reading, spec §5.6). The
 * learner keeps a shelf (want / reading / finished) and logs reading time,
 * which counts as meaning-focused input.
 */

export class BookNotFoundError extends Error {}

export const BOOK_STATUSES = ["want", "reading", "finished"] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];
export const BOOK_STATUS_LABELS: Record<BookStatus, string> = { want: "想读", reading: "在读", finished: "读完了" };

/** Longest single reading session that counts as study time. */
export const MAX_LOG_MINUTES = 600;

export type ShelfBook = {
  id: string;
  title: string;
  author: string;
  kind: "graded_reader" | "original";
  series: string | null;
  seriesLevel: string | null;
  level: string;
  levelLabel: string;
  levelNote: string | null;
  genre: "fiction" | "nonfiction";
  tags: string[];
  summaryZh: string;
  whyZh: string;
  publicDomain: boolean;
  status: BookStatus | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  minutes: number;
  pages: number;
};

export type Bookshelf = {
  learner: { level: CefrLevel; label: string; basis: string };
  reading: ShelfBook[];
  want: ShelfBook[];
  finished: ShelfBook[];
  /** At or just below the learner's level: comfortable extensive reading. */
  easy: ShelfBook[];
  /** One level above: a stretch. */
  stretch: ShelfBook[];
  all: ShelfBook[];
  stats: { finished: number; minutesThisWeek: number; minutesTotal: number };
};

const levelIndex = (level: string) => Math.max(0, CEFR_LEVELS.indexOf(level as CefrLevel));

export async function getBookshelf(db: DbExecutor, userId: string, weekStart: Date): Promise<Bookshelf> {
  const [rows, logs, week, learner] = await Promise.all([
    db
      .select({ book: books, shelf: userBooks })
      .from(books)
      .leftJoin(userBooks, and(eq(userBooks.bookId, books.id), eq(userBooks.userId, userId)))
      .where(isNull(books.archivedAt))
      .orderBy(asc(books.sortOrder)),
    db
      .select({
        bookId: bookReadingLogs.bookId,
        minutes: sql<number>`sum(${bookReadingLogs.minutes})::int`,
        pages: sql<number>`coalesce(sum(${bookReadingLogs.pages}), 0)::int`,
      })
      .from(bookReadingLogs)
      .where(eq(bookReadingLogs.userId, userId))
      .groupBy(bookReadingLogs.bookId),
    db
      .select({ minutes: sql<number>`coalesce(sum(${bookReadingLogs.minutes}), 0)::int` })
      .from(bookReadingLogs)
      .where(and(eq(bookReadingLogs.userId, userId), gte(bookReadingLogs.createdAt, weekStart))),
    learnerInputLevel(db, userId, "reading"),
  ]);
  const totals = new Map(logs.map((l) => [l.bookId, l]));
  const all: ShelfBook[] = rows.map(({ book: b, shelf }) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    kind: b.kind as ShelfBook["kind"],
    series: b.series,
    seriesLevel: b.seriesLevel,
    level: b.cefrLevel,
    levelLabel: isCefrLevel(b.cefrLevel) ? CEFR_LEVEL_LABELS[b.cefrLevel] : b.cefrLevel,
    levelNote: b.levelNote,
    genre: b.genre as ShelfBook["genre"],
    tags: b.tags,
    summaryZh: b.summaryZh,
    whyZh: b.whyZh,
    publicDomain: b.publicDomain,
    status: (shelf?.status as BookStatus | undefined) ?? null,
    startedAt: shelf?.startedAt ?? null,
    finishedAt: shelf?.finishedAt ?? null,
    minutes: totals.get(b.id)?.minutes ?? 0,
    pages: totals.get(b.id)?.pages ?? 0,
  }));

  const me = levelIndex(learner.level);
  const open = all.filter((b) => b.status === null);
  // Extensive reading should feel easy: the learner's level first, then one below; graded readers first up to B1.
  const easy = open
    .filter((b) => levelIndex(b.level) === me || levelIndex(b.level) === me - 1)
    .sort(
      (a, b) =>
        Number(levelIndex(b.level) === me) - Number(levelIndex(a.level) === me) ||
        (me <= 3 ? Number(b.kind === "graded_reader") - Number(a.kind === "graded_reader") : 0),
    )
    .slice(0, 6);
  const stretch = open.filter((b) => levelIndex(b.level) === me + 1).slice(0, 3);

  return {
    learner: { ...learner, label: CEFR_LEVEL_LABELS[learner.level] },
    reading: all.filter((b) => b.status === "reading"),
    want: all.filter((b) => b.status === "want"),
    finished: all.filter((b) => b.status === "finished").sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0)),
    easy,
    stretch,
    all,
    stats: {
      finished: all.filter((b) => b.status === "finished").length,
      minutesThisWeek: week[0]?.minutes ?? 0,
      minutesTotal: logs.reduce((n, l) => n + l.minutes, 0),
    },
  };
}

async function requireBook(db: DbExecutor, bookId: string) {
  const [row] = await db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), isNull(books.archivedAt)));
  if (!row) throw new BookNotFoundError(bookId);
}

/** Put a book on the shelf, move it, or take it off (status null). */
export async function setBookStatus(db: DbExecutor, userId: string, bookId: string, status: BookStatus | null, now = new Date()) {
  await requireBook(db, bookId);
  if (status === null) {
    await db.delete(userBooks).where(and(eq(userBooks.userId, userId), eq(userBooks.bookId, bookId)));
    return;
  }
  const [current] = await db
    .select()
    .from(userBooks)
    .where(and(eq(userBooks.userId, userId), eq(userBooks.bookId, bookId)));
  const startedAt = status === "want" ? (current?.startedAt ?? null) : (current?.startedAt ?? now);
  const finishedAt = status === "finished" ? (current?.status === "finished" ? current.finishedAt : now) : null;
  await db
    .insert(userBooks)
    .values({ userId, bookId, status, startedAt, finishedAt })
    .onConflictDoUpdate({ target: [userBooks.userId, userBooks.bookId], set: { status, startedAt, finishedAt } });
}

/** Log reading time; a book that wasn't on the shelf (or only wanted) becomes "reading". Idempotent. */
export async function logReading(
  db: DbExecutor,
  userId: string,
  input: { bookId: string; minutes: number; pages?: number | null; clientRequestId: string },
  now = new Date(),
): Promise<{ duplicate: boolean }> {
  await requireBook(db, input.bookId);
  const [row] = await db
    .insert(bookReadingLogs)
    .values({ userId, bookId: input.bookId, minutes: input.minutes, pages: input.pages ?? null, clientRequestId: input.clientRequestId, createdAt: now })
    .onConflictDoNothing({ target: bookReadingLogs.clientRequestId })
    .returning({ id: bookReadingLogs.id });
  if (!row) return { duplicate: true };
  const [current] = await db
    .select({ status: userBooks.status })
    .from(userBooks)
    .where(and(eq(userBooks.userId, userId), eq(userBooks.bookId, input.bookId)));
  if (!current || current.status === "want") await setBookStatus(db, userId, input.bookId, "reading", now);
  return { duplicate: false };
}
