import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/connection";
import { assessmentAttempts, assessmentItems, assessmentSessions, skillEstimates } from "@/db/schema";

import { DIAGNOSTIC_SKILLS, type AssessmentItemContent, type DiagnosticSkill } from "../content";
import {
  MAX_ITEMS,
  estimateSkill,
  nextItem,
  scoreItem,
  startLevel,
  toClientItem,
  type ClientAssessmentItem,
  type SkillEstimate,
} from "../domain/engine";

/**
 * Placement diagnostic sessions (spec §4.2). One session at a time; it can be
 * paused (just leave) and resumed, and any skill can be skipped. Answers are
 * scored here and keys never reach the browser.
 */

export const BANK_VERSION = "diagnostic-v1";

export class AssessmentSessionNotFoundError extends Error {}
export class AssessmentItemRejectedError extends Error {}

export type SkillProgress = {
  skill: DiagnosticSkill;
  answered: number;
  max: number;
  status: "pending" | "in_progress" | "done" | "skipped";
};

export type AssessmentState = {
  sessionId: string;
  status: "in_progress" | "completed";
  selfReportedLevel: string | null;
  skills: SkillProgress[];
  current: { skill: DiagnosticSkill; item: ClientAssessmentItem; index: number; max: number } | null;
  writingSample: string | null;
};

type ItemRow = AssessmentItemContent & { difficulty: number };

async function loadItems(db: DbExecutor, bankVersion: string): Promise<ItemRow[]> {
  const rows = await db
    .select({ content: assessmentItems.content })
    .from(assessmentItems)
    .where(and(eq(assessmentItems.bankVersion, bankVersion), isNull(assessmentItems.archivedAt)))
    .orderBy(asc(assessmentItems.id));
  return rows.map((r) => r.content as ItemRow);
}

async function loadAttempts(db: DbExecutor, sessionId: string) {
  return db
    .select({
      itemId: assessmentAttempts.itemId,
      skill: assessmentAttempts.skill,
      level: assessmentAttempts.cefrLevel,
      isCorrect: assessmentAttempts.isCorrect,
    })
    .from(assessmentAttempts)
    .where(eq(assessmentAttempts.sessionId, sessionId))
    .orderBy(asc(assessmentAttempts.createdAt), asc(assessmentAttempts.id));
}

async function getOwnedSession(db: DbExecutor, userId: string, sessionId: string) {
  const [session] = await db
    .select()
    .from(assessmentSessions)
    .where(and(eq(assessmentSessions.id, sessionId), eq(assessmentSessions.userId, userId)))
    .limit(1);
  if (!session) throw new AssessmentSessionNotFoundError(sessionId);
  return session;
}

/** Work out per-skill progress and the next item from the stored attempts. */
function computeState(
  session: typeof assessmentSessions.$inferSelect,
  items: ItemRow[],
  attempts: Awaited<ReturnType<typeof loadAttempts>>,
  avoid: ReadonlySet<string> = new Set(),
): { state: AssessmentState; next: ItemRow | null } {
  const start = startLevel(session.selfReportedLevel);
  const skipped = new Set(session.skippedSkills);
  let current: AssessmentState["current"] = null;
  let next: ItemRow | null = null;

  const skills = DIAGNOSTIC_SKILLS.map((skill): SkillProgress => {
    const mine = attempts.filter((a) => a.skill === skill);
    const pool = items.filter((i) => i.skill === skill);
    const max = Math.min(MAX_ITEMS[skill], pool.length);
    if (skipped.has(skill)) return { skill, answered: mine.length, max, status: "skipped" };
    const candidate = session.status === "completed" ? null : nextItem(skill, mine, pool, start, avoid);
    if (!candidate) return { skill, answered: mine.length, max, status: "done" };
    if (!current) {
      current = { skill, item: toClientItem(candidate), index: mine.length + 1, max };
      next = candidate;
    }
    return { skill, answered: mine.length, max, status: mine.length > 0 || current.skill === skill ? "in_progress" : "pending" };
  });

  return {
    state: {
      sessionId: session.id,
      status: session.status as AssessmentState["status"],
      selfReportedLevel: session.selfReportedLevel,
      skills,
      current,
      writingSample: session.writingSample,
    },
    next,
  };
}

export async function getActiveSession(db: DbExecutor, userId: string) {
  const [session] = await db
    .select()
    .from(assessmentSessions)
    .where(and(eq(assessmentSessions.userId, userId), eq(assessmentSessions.status, "in_progress")))
    .orderBy(desc(assessmentSessions.startedAt))
    .limit(1);
  return session ?? null;
}

export async function getLatestCompletedSession(db: DbExecutor, userId: string) {
  const [session] = await db
    .select()
    .from(assessmentSessions)
    .where(and(eq(assessmentSessions.userId, userId), eq(assessmentSessions.status, "completed")))
    .orderBy(desc(assessmentSessions.completedAt))
    .limit(1);
  return session ?? null;
}

/** Resume the open session, or start a new one. */
export async function startOrResumeAssessment(db: Database, userId: string, selfReportedLevel: string | null) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`assessment:${userId}`}))`);
    const open = await getActiveSession(tx, userId);
    if (open) return open.id;
    const [created] = await tx
      .insert(assessmentSessions)
      .values({ userId, bankVersion: BANK_VERSION, selfReportedLevel })
      .returning({ id: assessmentSessions.id });
    return created!.id;
  });
}

/** Items answered in the learner's previous completed diagnostic (a retake prefers other items). */
async function previousItemIds(db: DbExecutor, userId: string, session: typeof assessmentSessions.$inferSelect): Promise<Set<string>> {
  const [prev] = await db
    .select({ id: assessmentSessions.id })
    .from(assessmentSessions)
    .where(and(eq(assessmentSessions.userId, userId), eq(assessmentSessions.status, "completed"), sql`${assessmentSessions.startedAt} < ${session.startedAt.toISOString()}`))
    .orderBy(desc(assessmentSessions.startedAt))
    .limit(1);
  if (!prev) return new Set();
  const rows = await db.select({ itemId: assessmentAttempts.itemId }).from(assessmentAttempts).where(eq(assessmentAttempts.sessionId, prev.id));
  return new Set(rows.map((r) => r.itemId));
}

export async function getAssessmentState(db: DbExecutor, userId: string, sessionId: string): Promise<AssessmentState> {
  const session = await getOwnedSession(db, userId, sessionId);
  const [items, attempts, avoid] = await Promise.all([loadItems(db, session.bankVersion), loadAttempts(db, sessionId), previousItemIds(db, userId, session)]);
  return computeState(session, items, attempts, avoid).state;
}

export type AnswerItemInput = {
  sessionId: string;
  itemId: string;
  choice?: number;
  text?: string;
  durationMs?: number;
};

export type AnswerItemResult = {
  isCorrect: boolean;
  explanationZh: string;
  correctAnswer: string;
  duplicate: boolean;
  state: AssessmentState;
};

function displayAnswer(item: AssessmentItemContent) {
  return item.type === "choice" ? item.options[item.answer]! : item.answers[0]!;
}

/**
 * Score one answer. Only the item the engine is currently asking may be
 * answered; repeating the same item (a retried request) returns the stored result.
 */
export async function answerAssessmentItem(db: Database, userId: string, input: AnswerItemInput): Promise<AnswerItemResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`assessment:${userId}`}))`);
    const session = await getOwnedSession(tx, userId, input.sessionId);
    const items = await loadItems(tx, session.bankVersion);
    const item = items.find((i) => i.id === input.itemId);
    if (!item) throw new AssessmentItemRejectedError(`Unknown item ${input.itemId}`);
    const avoid = await previousItemIds(tx, userId, session);

    const [existing] = await tx
      .select()
      .from(assessmentAttempts)
      .where(and(eq(assessmentAttempts.sessionId, session.id), eq(assessmentAttempts.itemId, item.id)))
      .limit(1);
    if (existing) {
      const attempts = await loadAttempts(tx, session.id);
      return {
        isCorrect: existing.isCorrect,
        explanationZh: item.explanation_zh,
        correctAnswer: displayAnswer(item),
        duplicate: true,
        state: computeState(session, items, attempts, avoid).state,
      };
    }

    if (session.status !== "in_progress") throw new AssessmentItemRejectedError("Session already completed");
    const before = computeState(session, items, await loadAttempts(tx, session.id), avoid);
    if (before.next?.id !== item.id) throw new AssessmentItemRejectedError(`Item ${item.id} is not the current item`);

    const isCorrect = scoreItem(item, { choice: input.choice, text: input.text });
    await tx.insert(assessmentAttempts).values({
      sessionId: session.id,
      itemId: item.id,
      skill: item.skill,
      cefrLevel: item.level,
      response: item.type === "choice" ? { choice: input.choice ?? null } : { text: input.text ?? "" },
      isCorrect,
      durationMs: input.durationMs ?? null,
    });
    const attempts = await loadAttempts(tx, session.id);
    return {
      isCorrect,
      explanationZh: item.explanation_zh,
      correctAnswer: displayAnswer(item),
      duplicate: false,
      state: computeState(session, items, attempts, avoid).state,
    };
  });
}

/** Skip the rest of one skill (spec §4.2: every part can be skipped). */
export async function skipAssessmentSkill(db: DbExecutor, userId: string, sessionId: string, skill: DiagnosticSkill) {
  const session = await getOwnedSession(db, userId, sessionId);
  if (session.status !== "in_progress") return;
  if (session.skippedSkills.includes(skill)) return;
  await db
    .update(assessmentSessions)
    .set({ skippedSkills: [...session.skippedSkills, skill] })
    .where(eq(assessmentSessions.id, session.id));
}

export async function saveWritingSample(db: DbExecutor, userId: string, sessionId: string, sample: string) {
  const session = await getOwnedSession(db, userId, sessionId);
  const trimmed = sample.trim();
  await db
    .update(assessmentSessions)
    .set({ writingSample: trimmed.length > 0 ? trimmed.slice(0, 2000) : null })
    .where(eq(assessmentSessions.id, session.id));
}

export type AssessmentResult = {
  sessionId: string;
  completedAt: Date;
  estimates: { skill: DiagnosticSkill; estimate: SkillEstimate }[];
  skipped: DiagnosticSkill[];
  writingSample: string | null;
};

/**
 * Finish the session and write one estimate per answered skill. Safe to call
 * twice: a completed session just returns its result.
 */
export async function completeAssessment(db: Database, userId: string, sessionId: string, now = new Date()): Promise<AssessmentResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`assessment:${userId}`}))`);
    const session = await getOwnedSession(tx, userId, sessionId);
    const attempts = await loadAttempts(tx, session.id);
    const estimates = DIAGNOSTIC_SKILLS.flatMap((skill) => {
      const estimate = estimateSkill(attempts.filter((a) => a.skill === skill));
      return estimate ? [{ skill, estimate }] : [];
    });

    let completedAt = session.completedAt ?? now;
    if (session.status !== "completed") {
      completedAt = now;
      await tx.update(assessmentSessions).set({ status: "completed", completedAt: now }).where(eq(assessmentSessions.id, session.id));
      if (estimates.length > 0) {
        await tx.insert(skillEstimates).values(
          estimates.map(({ skill, estimate }) => ({
            userId,
            skill,
            estimatedLevel: estimate.level,
            confidence: estimate.confidence,
            evidenceCount: estimate.evidenceCount,
            source: `assessment:${session.id}`,
            details: { correct: estimate.correct, byLevel: estimate.byLevel, mayBeHigher: estimate.mayBeHigher },
            createdAt: now,
          })),
        );
      }
    }
    return {
      sessionId: session.id,
      completedAt,
      estimates,
      skipped: DIAGNOSTIC_SKILLS.filter((s) => session.skippedSkills.includes(s)),
      writingSample: session.writingSample,
    };
  });
}

export type CurrentEstimate = {
  skill: string;
  level: string;
  confidence: string;
  evidenceCount: number;
  source: string;
  createdAt: Date;
  mayBeHigher: boolean;
};

/** Latest estimate per skill. */
export async function getCurrentEstimates(db: DbExecutor, userId: string): Promise<CurrentEstimate[]> {
  const rows = await db
    .selectDistinctOn([skillEstimates.skill], {
      skill: skillEstimates.skill,
      level: skillEstimates.estimatedLevel,
      confidence: skillEstimates.confidence,
      evidenceCount: skillEstimates.evidenceCount,
      source: skillEstimates.source,
      createdAt: skillEstimates.createdAt,
      details: skillEstimates.details,
    })
    .from(skillEstimates)
    .where(eq(skillEstimates.userId, userId))
    .orderBy(skillEstimates.skill, desc(skillEstimates.createdAt));
  return rows.map(({ details, ...r }) => ({ ...r, mayBeHigher: Boolean((details as { mayBeHigher?: boolean } | null)?.mayBeHigher) }));
}

export type AssessmentHistoryEntry = {
  sessionId: string;
  completedAt: Date;
  skipped: string[];
  estimates: { skill: string; level: string; confidence: string; evidenceCount: number }[];
};

/** Every completed diagnostic with its per-skill results, newest first (spec Phase 4: assessment history). */
export async function listAssessmentHistory(db: DbExecutor, userId: string): Promise<AssessmentHistoryEntry[]> {
  const sessions = await db
    .select({ id: assessmentSessions.id, completedAt: assessmentSessions.completedAt, skipped: assessmentSessions.skippedSkills })
    .from(assessmentSessions)
    .where(and(eq(assessmentSessions.userId, userId), eq(assessmentSessions.status, "completed")))
    .orderBy(desc(assessmentSessions.completedAt));
  if (sessions.length === 0) return [];
  const rows = await db
    .select({ source: skillEstimates.source, skill: skillEstimates.skill, level: skillEstimates.estimatedLevel, confidence: skillEstimates.confidence, evidenceCount: skillEstimates.evidenceCount })
    .from(skillEstimates)
    .where(and(eq(skillEstimates.userId, userId), inArray(skillEstimates.source, sessions.map((s) => `assessment:${s.id}`))));
  return sessions.map((s) => ({
    sessionId: s.id,
    completedAt: s.completedAt!,
    skipped: s.skipped,
    estimates: rows.filter((r) => r.source === `assessment:${s.id}`).map(({ source: _s, ...r }) => (void _s, r)),
  }));
}

export type EstimatePoint = { skill: string; level: string; confidence: string; evidenceCount: number; source: string; createdAt: Date };

/** The full history of skill estimates (diagnostics, practice, AI writing), oldest first. */
export async function getEstimateHistory(db: DbExecutor, userId: string): Promise<EstimatePoint[]> {
  return db
    .select({ skill: skillEstimates.skill, level: skillEstimates.estimatedLevel, confidence: skillEstimates.confidence, evidenceCount: skillEstimates.evidenceCount, source: skillEstimates.source, createdAt: skillEstimates.createdAt })
    .from(skillEstimates)
    .where(eq(skillEstimates.userId, userId))
    .orderBy(asc(skillEstimates.createdAt));
}
