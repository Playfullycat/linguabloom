import { and, desc, eq, isNotNull, like, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/connection";
import { contentInteractions, exerciseAttempts, exercises, learningContents, skillEstimates } from "@/db/schema";
import { CEFR_LEVELS, type CefrLevel } from "@/modules/curriculum/domain/cefr";

/**
 * Skill estimates that keep learning from practice (spec §4.2, §4.4): grammar
 * from grammar exercises, reading and listening from comprehension questions.
 * A new estimate is written only when there is enough evidence and something
 * changed, so the history stays meaningful.
 */

export type PracticeSkill = "grammar" | "reading" | "listening";

/** Recent attempts considered (newest first). */
const WINDOW = 40;
const MIN_EVIDENCE = 8;
const LEVEL_MIN_ATTEMPTS = 4;
const LEVEL_PASS = 0.7;

export type PracticeEstimate = {
  level: CefrLevel;
  confidence: "low" | "medium" | "high";
  evidenceCount: number;
  byLevel: Record<string, { correct: number; total: number }>;
};

/** Highest level with at least 4 recent attempts and ≥70 % correct; else the lowest level practised. */
export function estimateFromAttempts(attempts: { level: string; isCorrect: boolean }[]): PracticeEstimate | null {
  if (attempts.length < MIN_EVIDENCE) return null;
  const byLevel: Record<string, { correct: number; total: number }> = {};
  for (const a of attempts) {
    const b = (byLevel[a.level] ??= { correct: 0, total: 0 });
    b.total += 1;
    if (a.isCorrect) b.correct += 1;
  }
  const levels = CEFR_LEVELS.filter((l) => byLevel[l]);
  let level: CefrLevel = levels[0]!;
  for (const l of levels) {
    const b = byLevel[l]!;
    if (b.total >= LEVEL_MIN_ATTEMPTS && b.correct / b.total >= LEVEL_PASS) level = l;
  }
  const n = attempts.length;
  const confidence = n >= WINDOW && levels.length >= 2 ? "high" : n >= 15 ? "medium" : "low";
  return { level, confidence, evidenceCount: n, byLevel };
}

async function recentAttempts(db: DbExecutor, userId: string, skill: PracticeSkill) {
  if (skill === "grammar") {
    return db
      .select({ level: exercises.cefrLevel, isCorrect: sql<boolean>`${exerciseAttempts.isCorrect}` })
      .from(exerciseAttempts)
      .innerJoin(exercises, eq(exercises.id, exerciseAttempts.exerciseId))
      .where(and(eq(exerciseAttempts.userId, userId), isNotNull(exerciseAttempts.isCorrect)))
      .orderBy(desc(exerciseAttempts.createdAt))
      .limit(WINDOW);
  }
  return db
    .select({ level: learningContents.cefrLevel, isCorrect: sql<boolean>`${contentInteractions.isCorrect}` })
    .from(contentInteractions)
    .innerJoin(learningContents, eq(learningContents.id, contentInteractions.contentId))
    .where(and(eq(contentInteractions.userId, userId), eq(contentInteractions.kind, "question"), eq(learningContents.type, skill)))
    .orderBy(desc(contentInteractions.createdAt))
    .limit(WINDOW);
}

/** Recompute and, if it changed meaningfully, append a "practice" estimate. Returns the new row or null. */
export async function refreshPracticeEstimate(db: DbExecutor, userId: string, skill: PracticeSkill, now = new Date()) {
  const estimate = estimateFromAttempts(await recentAttempts(db, userId, skill));
  if (!estimate) return null;
  const [last] = await db
    .select()
    .from(skillEstimates)
    .where(and(eq(skillEstimates.userId, userId), eq(skillEstimates.skill, skill), like(skillEstimates.source, "practice%")))
    .orderBy(desc(skillEstimates.createdAt))
    .limit(1);
  const changed =
    !last || last.estimatedLevel !== estimate.level || last.confidence !== estimate.confidence || estimate.evidenceCount - last.evidenceCount >= 10;
  if (!changed) return null;
  const [row] = await db
    .insert(skillEstimates)
    .values({
      userId,
      skill,
      estimatedLevel: estimate.level,
      confidence: estimate.confidence,
      evidenceCount: estimate.evidenceCount,
      source: "practice",
      details: { byLevel: estimate.byLevel, window: WINDOW },
      createdAt: now,
    })
    .returning();
  return row!;
}
