import { and, asc, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/connection";
import { learningContents, lessons, reviewCards, reviewLogs, userVocabulary, vocabularyEntries } from "@/db/schema";
import { startOfLocalDay } from "@/lib/time";

import {
  buildCloze,
  enforceRating,
  isTypedAnswerCorrect,
  isTypedCard,
  spokenText,
  type Grade,
  type ReviewCardType,
} from "../domain/cards";
import {
  DIFFICULT_LAPSES,
  FSRS_STATE,
  SCHEDULER_VERSION,
  getScheduler,
  reviveCard,
  serializeCard,
  type FsrsCardJson,
} from "../domain/scheduler";
import { refreshVocabularyStatus, CardNotFoundError } from "./vocabulary";

/** Default new cards per local day; the learner's study_preferences.new_items_limit overrides it. */
export const NEW_CARDS_PER_DAY = 20;
/** Siblings (other cards of the same word) wait this long after a review (spec §2.3 sibling bury). */
export const SIBLING_GAP_HOURS = 12;
const QUEUE_LIMIT = 100;

export type ClientReviewCard = {
  id: string;
  cardType: ReviewCardType;
  entryId: string;
  text: string;
  spoken: string;
  ipa: string | null;
  zh: string;
  exampleEn: string;
  exampleZh: string;
  cloze: { sentence: string; answer: string } | null;
  isNew: boolean;
};

type CardRow = {
  id: string;
  cardType: ReviewCardType;
  entryId: string;
  state: number;
  text: string;
  ipa: string | null;
  zh: string;
  exampleEn: string;
  exampleZh: string;
};

function toClientCard(row: CardRow): ClientReviewCard {
  return {
    id: row.id,
    cardType: row.cardType,
    entryId: row.entryId,
    text: row.text,
    spoken: spokenText(row.text),
    ipa: row.ipa,
    zh: row.zh,
    exampleEn: row.exampleEn,
    exampleZh: row.exampleZh,
    cloze: row.cardType === "cloze" ? buildCloze(row) : null,
    isNew: row.state === FSRS_STATE.New,
  };
}

const cardColumns = {
  id: reviewCards.id,
  cardType: reviewCards.cardType,
  entryId: reviewCards.entryId,
  state: reviewCards.state,
  text: vocabularyEntries.text,
  ipa: vocabularyEntries.ipa,
  zh: vocabularyEntries.definitionZh,
  exampleEn: vocabularyEntries.exampleEn,
  exampleZh: vocabularyEntries.exampleZh,
};

async function newCardsIntroducedSince(db: DbExecutor, userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${reviewLogs.cardId})::int` })
    .from(reviewLogs)
    .where(and(eq(reviewLogs.userId, userId), gte(reviewLogs.reviewedAt, since), sql`(${reviewLogs.stateBefore}->>'state')::int = 0`));
  return row?.n ?? 0;
}

/**
 * Today's queue: due learning/review cards first (oldest due first), then new
 * cards up to the daily limit. At most one card per word, and no card whose
 * sibling was reviewed in the last SIBLING_GAP_HOURS (spec §2.3).
 */
export async function getReviewQueue(db: DbExecutor, userId: string, now: Date, timeZone: string, newPerDay = NEW_CARDS_PER_DAY) {
  // Written out explicitly: Drizzle does not expand table aliases inside raw SQL.
  const siblingCutoff = new Date(now.getTime() - SIBLING_GAP_HOURS * 3_600_000).toISOString();
  const recentSiblingReview = sql`exists (
    select 1 from review_logs rl
    join review_cards sibling on sibling.id = rl.card_id
    where sibling.user_id = ${userId}
      and sibling.entry_id = ${reviewCards.entryId}
      and sibling.id <> ${reviewCards.id}
      and rl.reviewed_at > ${siblingCutoff}::timestamptz
  )`;

  const rows = await db
    .select(cardColumns)
    .from(reviewCards)
    .innerJoin(vocabularyEntries, eq(vocabularyEntries.id, reviewCards.entryId))
    .where(and(eq(reviewCards.userId, userId), isNull(reviewCards.suspendedAt), lte(reviewCards.dueAt, now), sql`not ${recentSiblingReview}`))
    // Receptive before productive for the same word (recognise first, then produce).
    .orderBy(
      sql`${reviewCards.state} = 0`,
      asc(reviewCards.dueAt),
      asc(reviewCards.createdAt),
      sql`array_position(array['recognition','listening','recall','spelling','cloze']::text[], ${reviewCards.cardType})`,
    )
    .limit(QUEUE_LIMIT * 3);

  const newBudget = Math.max(0, newPerDay - (await newCardsIntroducedSince(db, userId, startOfLocalDay(now, timeZone))));
  const seenEntries = new Set<string>();
  const queue: ClientReviewCard[] = [];
  let newTaken = 0;
  let newWaiting = 0;
  for (const row of rows) {
    if (seenEntries.has(row.entryId)) continue;
    if (row.state === FSRS_STATE.New) {
      if (newTaken >= newBudget) {
        newWaiting += 1;
        continue;
      }
      newTaken += 1;
    }
    seenEntries.add(row.entryId);
    queue.push(toClientCard(row as CardRow));
    if (queue.length >= QUEUE_LIMIT) break;
  }
  return { cards: queue, newWaiting, newBudget };
}

/** A single card for re-showing within a session (learning steps). */
export async function getClientCard(db: DbExecutor, userId: string, cardId: string): Promise<ClientReviewCard | null> {
  const [row] = await db
    .select(cardColumns)
    .from(reviewCards)
    .innerJoin(vocabularyEntries, eq(vocabularyEntries.id, reviewCards.entryId))
    .where(and(eq(reviewCards.id, cardId), eq(reviewCards.userId, userId)))
    .limit(1);
  return row ? toClientCard(row as CardRow) : null;
}

export type AnswerInput = {
  cardId: string;
  /** Learner's rating; adjusted on the server for typed cards. */
  rating: Grade;
  clientRequestId: string;
  elapsedMs?: number;
  typed?: string;
  overridden?: boolean;
  hintUsed?: boolean;
};

export type AnswerResult = {
  rating: Grade;
  answerCorrect: boolean | null;
  dueAt: string;
  state: number;
  difficult: boolean;
  duplicate: boolean;
};

/**
 * Record one review: enforce the rating rules, schedule with FSRS, update the
 * card, append the log — in one transaction, idempotent per client request.
 */
export async function answerCard(db: Database, userId: string, input: AnswerInput, now = new Date()): Promise<AnswerResult> {
  const scheduler = await getScheduler();
  return db.transaction(async (tx) => {
    const [previous] = await tx
      .select({ rating: reviewLogs.rating, answerCorrect: reviewLogs.answerCorrect, cardId: reviewLogs.cardId })
      .from(reviewLogs)
      .where(and(eq(reviewLogs.clientRequestId, input.clientRequestId), eq(reviewLogs.userId, userId)))
      .limit(1);
    if (previous) {
      const [card] = await tx
        .select({ dueAt: reviewCards.dueAt, state: reviewCards.state, difficultAt: reviewCards.difficultAt })
        .from(reviewCards)
        .where(eq(reviewCards.id, previous.cardId));
      return {
        rating: previous.rating as Grade,
        answerCorrect: previous.answerCorrect,
        dueAt: card!.dueAt.toISOString(),
        state: card!.state,
        difficult: card!.difficultAt !== null,
        duplicate: true,
      };
    }

    const [row] = await tx
      .select({ card: reviewCards, text: vocabularyEntries.text, exampleEn: vocabularyEntries.exampleEn })
      .from(reviewCards)
      .innerJoin(vocabularyEntries, eq(vocabularyEntries.id, reviewCards.entryId))
      .where(and(eq(reviewCards.id, input.cardId), eq(reviewCards.userId, userId)))
      .for("update", { of: reviewCards })
      .limit(1);
    if (!row) throw new CardNotFoundError(input.cardId);

    const { card } = row;
    const typed = isTypedCard(card.cardType);
    const answerCorrect = typed ? isTypedAnswerCorrect(row, card.cardType, input.typed ?? "") : null;
    const rating = enforceRating({
      cardType: card.cardType,
      requested: input.rating,
      answerCorrect,
      overridden: Boolean(input.overridden),
      hintUsed: Boolean(input.hintUsed),
    });

    const before = card.fsrsState as FsrsCardJson;
    const result = scheduler.review({ card: reviveCard(before), grade: rating, now });
    const next = result.card;
    const becameDifficult = card.difficultAt === null && next.lapses >= DIFFICULT_LAPSES;

    await tx
      .update(reviewCards)
      .set({
        fsrsState: serializeCard(next),
        schedulerVersion: SCHEDULER_VERSION,
        dueAt: next.dueAt,
        state: next.state,
        reps: next.reps,
        lapses: next.lapses,
        stability: next.stability,
        difficultAt: becameDifficult ? now : card.difficultAt,
      })
      .where(eq(reviewCards.id, card.id));

    await tx.insert(reviewLogs).values({
      userId,
      cardId: card.id,
      rating,
      reviewedAt: now,
      elapsedMs: input.elapsedMs ?? null,
      responseMode: typed ? "typed" : "self",
      answerCorrect,
      hintUsed: Boolean(input.hintUsed),
      userAnswer: typed ? { typed: input.typed ?? "", overridden: Boolean(input.overridden) } : null,
      stateBefore: before,
      schedulerResult: { card: serializeCard(next), revlog: JSON.parse(JSON.stringify(result.revlog)) },
      algorithmVersion: SCHEDULER_VERSION,
      clientRequestId: input.clientRequestId,
    });

    await refreshVocabularyStatus(tx, userId, card.entryId);

    return {
      rating,
      answerCorrect,
      dueAt: next.dueAt.toISOString(),
      state: next.state,
      difficult: becameDifficult || card.difficultAt !== null,
      duplicate: false,
    };
  });
}

/**
 * Rebuild a card's FSRS state by replaying its review log from the card's
 * creation — proves the stored state is reproducible (spec §14.2).
 */
export async function replayCardState(db: DbExecutor, userId: string, cardId: string) {
  const scheduler = await getScheduler();
  const [card] = await db
    .select({ id: reviewCards.id, createdAt: reviewCards.createdAt })
    .from(reviewCards)
    .where(and(eq(reviewCards.id, cardId), eq(reviewCards.userId, userId)));
  if (!card) throw new CardNotFoundError(cardId);
  const logs = await db
    .select({ rating: reviewLogs.rating, reviewedAt: reviewLogs.reviewedAt })
    .from(reviewLogs)
    .where(eq(reviewLogs.cardId, cardId))
    .orderBy(asc(reviewLogs.reviewedAt));
  let state = scheduler.newCard({ now: card.createdAt, cardId: card.id });
  for (const log of logs) state = scheduler.review({ card: state, grade: log.rating as Grade, now: log.reviewedAt }).card;
  return serializeCard(state);
}

// ------------------------------------------------------------- statistics ----

export type ReviewStats = {
  dueNow: number;
  overdue: number;
  newWaiting: number;
  totalWords: number;
  byStatus: Record<string, number>;
  difficultWords: number;
  receptiveAverage: number;
  productiveAverage: number;
  reviewsToday: number;
  /** Share of reviews of already-learned cards (state Review) not rated Again. */
  retention: { days: number; reviews: number; rate: number | null }[];
};

export async function getReviewStats(db: DbExecutor, userId: string, now: Date, timeZone: string): Promise<ReviewStats> {
  const dayStart = startOfLocalDay(now, timeZone);

  const [due] = await db
    .select({
      // Raw SQL parameters are not type-mapped by Drizzle: pass timestamps as ISO strings.
      dueNow: sql<number>`count(*) filter (where ${reviewCards.dueAt} <= ${now.toISOString()}::timestamptz and ${reviewCards.state} <> 0)::int`,
      overdue: sql<number>`count(*) filter (where ${reviewCards.dueAt} < ${dayStart.toISOString()}::timestamptz and ${reviewCards.state} <> 0)::int`,
      newCards: sql<number>`count(*) filter (where ${reviewCards.state} = 0)::int`,
    })
    .from(reviewCards)
    .where(and(eq(reviewCards.userId, userId), isNull(reviewCards.suspendedAt)));

  const statusRows = await db
    .select({
      status: userVocabulary.status,
      n: sql<number>`count(*)::int`,
      receptive: sql<number>`coalesce(avg(${userVocabulary.receptiveMastery}), 0)::float`,
      productive: sql<number>`coalesce(avg(${userVocabulary.productiveMastery}), 0)::float`,
    })
    .from(userVocabulary)
    .where(eq(userVocabulary.userId, userId))
    .groupBy(userVocabulary.status);

  const totalWords = statusRows.reduce((sum, r) => sum + r.n, 0);
  const weighted = (key: "receptive" | "productive") =>
    totalWords === 0 ? 0 : statusRows.reduce((sum, r) => sum + r[key] * r.n, 0) / totalWords;

  const [today] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reviewLogs)
    .where(and(eq(reviewLogs.userId, userId), gte(reviewLogs.reviewedAt, dayStart)));

  const retention = [];
  for (const days of [7, 30, 90]) {
    const [r] = await db
      .select({
        reviews: sql<number>`count(*)::int`,
        kept: sql<number>`count(*) filter (where ${reviewLogs.rating} > 1)::int`,
      })
      .from(reviewLogs)
      .where(
        and(
          eq(reviewLogs.userId, userId),
          gte(reviewLogs.reviewedAt, new Date(now.getTime() - days * 86_400_000)),
          sql`(${reviewLogs.stateBefore}->>'state')::int = 2`,
        ),
      );
    retention.push({ days, reviews: r?.reviews ?? 0, rate: r && r.reviews > 0 ? r.kept / r.reviews : null });
  }

  const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.n]));
  return {
    dueNow: due?.dueNow ?? 0,
    overdue: due?.overdue ?? 0,
    newWaiting: due?.newCards ?? 0,
    totalWords,
    byStatus,
    difficultWords: byStatus.difficult ?? 0,
    receptiveAverage: weighted("receptive"),
    productiveAverage: weighted("productive"),
    reviewsToday: today?.n ?? 0,
    retention,
  };
}

// ---------------------------------------------------------- vocabulary lab ----

export type VocabularyListItem = {
  entryId: string;
  text: string;
  ipa: string | null;
  zh: string;
  status: string;
  receptiveMastery: number;
  productiveMastery: number;
  nextDueAt: Date | null;
  addedFrom: string;
};

export async function listVocabulary(
  db: DbExecutor,
  userId: string,
  filter: { status?: string; q?: string },
): Promise<VocabularyListItem[]> {
  const conditions = [eq(userVocabulary.userId, userId)];
  if (filter.status) conditions.push(eq(userVocabulary.status, filter.status as never));
  if (filter.q) {
    const pattern = `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(sql`(${vocabularyEntries.text} ilike ${pattern} or ${vocabularyEntries.definitionZh} ilike ${pattern})`);
  }
  return db
    .select({
      entryId: userVocabulary.entryId,
      text: vocabularyEntries.text,
      ipa: vocabularyEntries.ipa,
      zh: vocabularyEntries.definitionZh,
      status: userVocabulary.status,
      receptiveMastery: userVocabulary.receptiveMastery,
      productiveMastery: userVocabulary.productiveMastery,
      nextDueAt: sql<Date | null>`(select min(${reviewCards.dueAt}) from ${reviewCards} where ${reviewCards.userId} = ${userId} and ${reviewCards.entryId} = ${userVocabulary.entryId} and ${reviewCards.suspendedAt} is null)`,
      addedFrom: userVocabulary.addedFrom,
    })
    .from(userVocabulary)
    .innerJoin(vocabularyEntries, eq(vocabularyEntries.id, userVocabulary.entryId))
    .where(and(...conditions))
    .orderBy(desc(userVocabulary.firstSeenAt), asc(vocabularyEntries.text))
    .limit(500);
}

export async function getVocabularyDetail(db: DbExecutor, userId: string, entryId: string) {
  const [row] = await db
    .select({ entry: vocabularyEntries, user: userVocabulary })
    .from(userVocabulary)
    .innerJoin(vocabularyEntries, eq(vocabularyEntries.id, userVocabulary.entryId))
    .where(and(eq(userVocabulary.userId, userId), eq(userVocabulary.entryId, entryId)))
    .limit(1);
  if (!row) return null;

  const cards = await db
    .select()
    .from(reviewCards)
    .where(and(eq(reviewCards.userId, userId), eq(reviewCards.entryId, entryId)))
    .orderBy(asc(reviewCards.createdAt));

  const history = await db
    .select({
      reviewedAt: reviewLogs.reviewedAt,
      rating: reviewLogs.rating,
      cardType: reviewCards.cardType,
      answerCorrect: reviewLogs.answerCorrect,
    })
    .from(reviewLogs)
    .innerJoin(reviewCards, eq(reviewCards.id, reviewLogs.cardId))
    .where(and(eq(reviewLogs.userId, userId), eq(reviewCards.entryId, entryId), ne(reviewLogs.rating, 0)))
    .orderBy(desc(reviewLogs.reviewedAt))
    .limit(30);

  const lessonId = row.user.addedFrom.startsWith("lesson:") ? row.user.addedFrom.slice("lesson:".length) : null;
  const [sourceLesson] = lessonId
    ? await db.select({ id: lessons.id, titleEn: lessons.titleEn, titleZh: lessons.titleZh }).from(lessons).where(eq(lessons.id, lessonId)).limit(1)
    : [];

  const materialId = row.user.addedFrom.startsWith("material:") ? row.user.addedFrom.slice("material:".length) : null;
  const [sourceMaterial] = materialId
    ? await db
        .select({ id: learningContents.id, type: learningContents.type, titleEn: learningContents.titleEn, titleZh: learningContents.titleZh })
        .from(learningContents)
        .where(eq(learningContents.id, materialId))
        .limit(1)
    : [];

  return { entry: row.entry, vocabulary: row.user, cards, history, sourceLesson: sourceLesson ?? null, sourceMaterial: sourceMaterial ?? null };
}

/** Most recently added words (Today page). */
export async function getRecentWords(db: DbExecutor, userId: string, limit = 5) {
  return db
    .select({ entryId: userVocabulary.entryId, text: vocabularyEntries.text, zh: vocabularyEntries.definitionZh, status: userVocabulary.status })
    .from(userVocabulary)
    .innerJoin(vocabularyEntries, eq(vocabularyEntries.id, userVocabulary.entryId))
    .where(eq(userVocabulary.userId, userId))
    .orderBy(desc(userVocabulary.firstSeenAt), asc(vocabularyEntries.text))
    .limit(limit);
}
