import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/connection";
import { errorItems, errorOccurrences, exerciseAttempts, exercises, grammarPoints, type ErrorCategory } from "@/db/schema";
import { startOfLocalDay } from "@/lib/time";

/**
 * Error notebook (spec §2.8, §5.12). Every wrong answer becomes an
 * occurrence of an error item (category + knowledge point). When the same
 * error comes back, a short remediation round is offered; after passing it,
 * a retest with different exercises the next day checks the learning transfers.
 */

export class ErrorItemNotFoundError extends Error {}

export type PointType = "grammar" | "unit_grammar" | "vocabulary" | "material" | "lesson" | "writing" | "speaking";
export type ErrorSource = "lesson" | "review" | "grammar" | "reading" | "listening" | "writing" | "speaking";

export type RecordErrorInput = {
  category: ErrorCategory;
  pointType: PointType;
  pointId: string;
  title: string;
  source: ErrorSource;
  sourceRef: string;
  wrong: string | null;
  correct: string | null;
};

/** The same error this many times → offer a remediation round. */
export const REMEDIATION_AFTER = 2;
const REMEDIATION_SIZE = 3;
const REMEDIATION_PASS = 2;
const RETEST_SIZE = 2;

const clip = (s: string | null) => (s === null ? null : s.slice(0, 300));

/**
 * Add one occurrence. A resolved (or retest-pending) item that shows up again
 * becomes active again and counts as a recurrence.
 */
export async function recordError(db: DbExecutor, userId: string, input: RecordErrorInput, now = new Date()) {
  const [item] = await db
    .insert(errorItems)
    .values({
      userId,
      category: input.category,
      pointType: input.pointType,
      pointId: input.pointId,
      title: input.title,
      status: "active",
      occurrenceCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      lastWrong: clip(input.wrong),
      lastCorrect: clip(input.correct),
    })
    .onConflictDoUpdate({
      target: [errorItems.userId, errorItems.category, errorItems.pointType, errorItems.pointId],
      set: {
        title: input.title,
        occurrenceCount: sql`${errorItems.occurrenceCount} + 1`,
        lastSeenAt: now,
        lastWrong: clip(input.wrong),
        lastCorrect: clip(input.correct),
        recurredCount: sql`${errorItems.recurredCount} + case when ${errorItems.status} = 'resolved' then 1 else 0 end`,
        status: "active",
        remediationPassedAt: null,
        retestDueAt: null,
        resolvedAt: null,
      },
    })
    .returning({ id: errorItems.id });
  await db.insert(errorOccurrences).values({
    errorItemId: item!.id,
    userId,
    source: input.source,
    sourceRef: input.sourceRef.slice(0, 200),
    wrong: clip(input.wrong),
    correct: clip(input.correct),
    createdAt: now,
  });
  return item!.id;
}

// ----------------------------------------------------------------- read ----

export type ErrorListItem = typeof errorItems.$inferSelect & {
  needsRemediation: boolean;
  retestDue: boolean;
  canPractise: boolean;
  practiceHref: string | null;
};

async function practisablePoints(db: DbExecutor, pointIds: string[]) {
  if (pointIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ id: exercises.grammarPointId, n: sql<number>`count(*)::int` })
    .from(exercises)
    .where(and(inArray(exercises.grammarPointId, pointIds), isNull(exercises.archivedAt), sql`${exercises.scoringRule} <> 'self'`))
    .groupBy(exercises.grammarPointId);
  return new Set(rows.filter((r) => r.n >= REMEDIATION_SIZE + RETEST_SIZE).map((r) => r.id!));
}

/** Where to go to practise an item that has no exercise bank behind it. */
function sourceHref(item: typeof errorItems.$inferSelect, latestRef: string | null): string | null {
  switch (item.pointType) {
    case "grammar":
      return `/grammar/${item.pointId}`;
    case "vocabulary": {
      // A missed key word from a material may not be in the vocabulary lab: go back to the material.
      const id = item.pointId;
      if (/^(rd|ls)-/.test(id)) return `/${id.startsWith("ls-") ? "listening" : "reading"}/${id.split(".")[0]}`;
      return `/vocabulary/${encodeURIComponent(id)}`;
    }
    case "material": {
      const id = item.pointId.split("#")[0]!;
      return `/${id.startsWith("ls-") ? "listening" : "reading"}/${id}`;
    }
    case "writing":
      return "/writing";
    case "speaking":
      return "/speaking";
    case "lesson":
    case "unit_grammar":
      return latestRef ? `/lesson/${latestRef.split("#")[0]}` : null;
    default:
      return null;
  }
}

function decorate(item: typeof errorItems.$inferSelect, practisable: Set<string>, latestRef: string | null, now: Date): ErrorListItem {
  const canPractise = item.pointType === "grammar" && practisable.has(item.pointId);
  return {
    ...item,
    needsRemediation: item.status === "active" && item.occurrenceCount >= REMEDIATION_AFTER,
    retestDue: item.status === "retest" && item.retestDueAt !== null && item.retestDueAt <= now,
    canPractise,
    practiceHref: sourceHref(item, latestRef),
  };
}

async function latestRefs(db: DbExecutor, itemIds: string[]) {
  if (itemIds.length === 0) return new Map<string, string>();
  const rows = await db
    .selectDistinctOn([errorOccurrences.errorItemId], { id: errorOccurrences.errorItemId, ref: errorOccurrences.sourceRef })
    .from(errorOccurrences)
    .where(inArray(errorOccurrences.errorItemId, itemIds))
    .orderBy(errorOccurrences.errorItemId, desc(errorOccurrences.createdAt));
  return new Map(rows.map((r) => [r.id, r.ref]));
}

export async function listErrors(db: DbExecutor, userId: string, filter: { status?: string; category?: string } = {}, now = new Date()) {
  const conditions = [eq(errorItems.userId, userId)];
  if (filter.status) conditions.push(eq(errorItems.status, filter.status));
  if (filter.category) conditions.push(eq(errorItems.category, filter.category));
  const items = await db
    .select()
    .from(errorItems)
    .where(and(...conditions))
    .orderBy(sql`${errorItems.status} = 'resolved'`, desc(errorItems.lastSeenAt))
    .limit(300);
  const practisable = await practisablePoints(
    db,
    items.filter((i) => i.pointType === "grammar").map((i) => i.pointId),
  );
  const refs = await latestRefs(
    db,
    items.map((i) => i.id),
  );
  return items.map((i) => decorate(i, practisable, refs.get(i.id) ?? null, now));
}

export async function getErrorItem(db: DbExecutor, userId: string, id: string, now = new Date()) {
  const [item] = await db
    .select()
    .from(errorItems)
    .where(and(eq(errorItems.id, id), eq(errorItems.userId, userId)));
  if (!item) throw new ErrorItemNotFoundError(id);
  const occurrences = await db
    .select()
    .from(errorOccurrences)
    .where(eq(errorOccurrences.errorItemId, id))
    .orderBy(desc(errorOccurrences.createdAt))
    .limit(30);
  const practisable = await practisablePoints(db, item.pointType === "grammar" ? [item.pointId] : []);
  const [point] =
    item.pointType === "grammar"
      ? await db.select({ id: grammarPoints.id, titleEn: grammarPoints.titleEn, titleZh: grammarPoints.titleZh }).from(grammarPoints).where(eq(grammarPoints.id, item.pointId))
      : [];
  return { item: decorate(item, practisable, occurrences[0]?.sourceRef ?? null, now), occurrences, grammarPoint: point ?? null };
}

/** Counts for the Today plan and the notebook header. */
export async function errorSummary(db: DbExecutor, userId: string, now = new Date()) {
  const items = await listErrors(db, userId, {}, now);
  return {
    active: items.filter((i) => i.status === "active").length,
    needsRemediation: items.filter((i) => i.needsRemediation),
    retestDue: items.filter((i) => i.retestDue),
    resolved: items.filter((i) => i.status === "resolved").length,
  };
}

export async function saveErrorNote(db: DbExecutor, userId: string, id: string, note: string) {
  const updated = await db
    .update(errorItems)
    .set({ note: note.trim() === "" ? null : note.trim().slice(0, 2000) })
    .where(and(eq(errorItems.id, id), eq(errorItems.userId, userId)))
    .returning({ id: errorItems.id });
  if (updated.length === 0) throw new ErrorItemNotFoundError(id);
}

/** "I've got this": the learner closes an item; it reopens if the error comes back. */
export async function resolveManually(db: DbExecutor, userId: string, id: string, now = new Date()) {
  const updated = await db
    .update(errorItems)
    .set({ status: "resolved", resolvedAt: now, retestDueAt: null })
    .where(and(eq(errorItems.id, id), eq(errorItems.userId, userId)))
    .returning({ id: errorItems.id });
  if (updated.length === 0) throw new ErrorItemNotFoundError(id);
}

// ---------------------------------------------------------- remediation ----

export type PracticeMode = "remediation" | "retest";

/**
 * Exercises for a remediation round (3) or the retest (2). The retest uses
 * exercises not seen in remediation, preferring other exercise types —
 * a different context (spec §2.8).
 */
export async function getPracticeSet(db: DbExecutor, userId: string, itemId: string, mode: PracticeMode) {
  const { item } = await getErrorItem(db, userId, itemId);
  if (!item.canPractise) return [];
  const pool = await db
    .select({ id: exercises.id, type: exercises.exerciseType, sortOrder: exercises.sortOrder, difficulty: exercises.difficulty })
    .from(exercises)
    .where(and(eq(exercises.grammarPointId, item.pointId), isNull(exercises.archivedAt), sql`${exercises.scoringRule} <> 'self'`))
    .orderBy(asc(exercises.sortOrder));
  const history = await db
    .select({ exerciseId: exerciseAttempts.exerciseId, context: exerciseAttempts.context, isCorrect: exerciseAttempts.isCorrect })
    .from(exerciseAttempts)
    .where(and(eq(exerciseAttempts.userId, userId), inArray(exerciseAttempts.exerciseId, pool.map((p) => p.id))));

  if (mode === "remediation") {
    // Exercises the learner got wrong or hasn't seen come first; easier ones before harder.
    const wrong = new Set(history.filter((h) => h.isCorrect === false).map((h) => h.exerciseId));
    const seen = new Set(history.map((h) => h.exerciseId));
    const rank = (p: (typeof pool)[number]) => (wrong.has(p.id) ? 0 : seen.has(p.id) ? 2 : 1) * 10 + p.difficulty;
    return [...pool].sort((a, b) => rank(a) - rank(b) || a.sortOrder - b.sortOrder).slice(0, REMEDIATION_SIZE).map((p) => p.id);
  }
  const usedInRemediation = new Set(history.filter((h) => h.context === "remediation").map((h) => h.exerciseId));
  const remediationTypes = new Set(pool.filter((p) => usedInRemediation.has(p.id)).map((p) => p.type));
  const fresh = pool.filter((p) => !usedInRemediation.has(p.id));
  const candidates = fresh.length >= RETEST_SIZE ? fresh : pool;
  return [...candidates]
    .sort((a, b) => Number(remediationTypes.has(a.type)) - Number(remediationTypes.has(b.type)) || a.sortOrder - b.sortOrder)
    .slice(0, RETEST_SIZE)
    .map((p) => p.id);
}

export type RoundOutcome = { mode: PracticeMode; correct: number; total: number; passed: boolean; status: string; retestDueAt: Date | null };

/**
 * Score a finished round from the learner's latest attempts at its exercises.
 * Remediation: 2 of 3 correct → retest from the next local day. Retest: all
 * correct → resolved; otherwise back to active.
 */
export async function completeRound(
  db: Database,
  userId: string,
  input: { itemId: string; mode: PracticeMode; exerciseIds: string[]; timeZone: string },
  now = new Date(),
): Promise<RoundOutcome> {
  const { item } = await getErrorItem(db, userId, input.itemId, now);
  const latest = await db
    .selectDistinctOn([exerciseAttempts.exerciseId], { exerciseId: exerciseAttempts.exerciseId, isCorrect: exerciseAttempts.isCorrect })
    .from(exerciseAttempts)
    .where(
      and(
        eq(exerciseAttempts.userId, userId),
        eq(exerciseAttempts.errorItemId, item.id),
        eq(exerciseAttempts.context, input.mode),
        inArray(exerciseAttempts.exerciseId, input.exerciseIds),
        gte(exerciseAttempts.createdAt, new Date(now.getTime() - 6 * 3_600_000)),
      ),
    )
    .orderBy(exerciseAttempts.exerciseId, desc(exerciseAttempts.createdAt));
  const total = input.exerciseIds.length;
  const correct = latest.filter((l) => l.isCorrect).length;
  const answeredAll = latest.length === total;

  if (input.mode === "remediation") {
    const passed = answeredAll && correct >= Math.min(REMEDIATION_PASS, total);
    if (passed) {
      // Next local day: a retest the same day would only measure short-term memory.
      const retestDueAt = new Date(startOfLocalDay(now, input.timeZone).getTime() + 86_400_000);
      await db.update(errorItems).set({ status: "retest", remediationPassedAt: now, retestDueAt }).where(eq(errorItems.id, item.id));
      return { mode: input.mode, correct, total, passed, status: "retest", retestDueAt };
    }
    return { mode: input.mode, correct, total, passed, status: item.status, retestDueAt: item.retestDueAt };
  }
  const passed = answeredAll && correct === total;
  if (passed) {
    await db.update(errorItems).set({ status: "resolved", resolvedAt: now, retestDueAt: null }).where(eq(errorItems.id, item.id));
    return { mode: input.mode, correct, total, passed, status: "resolved", retestDueAt: null };
  }
  await db.update(errorItems).set({ status: "active", retestDueAt: null, remediationPassedAt: null }).where(eq(errorItems.id, item.id));
  return { mode: input.mode, correct, total, passed, status: "active", retestDueAt: null };
}

/** Errors recorded against a grammar point (or the course units that teach it). */
export async function errorsForGrammarPoint(db: DbExecutor, userId: string, pointId: string, unitGrammarIds: string[]) {
  const items = await db
    .select()
    .from(errorItems)
    .where(
      and(
        eq(errorItems.userId, userId),
        sql`((${errorItems.pointType} = 'grammar' and ${errorItems.pointId} = ${pointId})${
          unitGrammarIds.length > 0 ? sql` or (${errorItems.pointType} = 'unit_grammar' and ${errorItems.pointId} in (${sql.join(unitGrammarIds.map((u) => sql`${u}`), sql`, `)}))` : sql``
        })`,
      ),
    )
    .orderBy(desc(errorItems.lastSeenAt))
    .limit(10);
  if (items.length === 0) return [];
  const occurrences = await db
    .select()
    .from(errorOccurrences)
    .where(inArray(errorOccurrences.errorItemId, items.map((i) => i.id)))
    .orderBy(desc(errorOccurrences.createdAt))
    .limit(10);
  return items.map((i) => ({ ...i, recent: occurrences.filter((o) => o.errorItemId === i.id).slice(0, 3) }));
}

