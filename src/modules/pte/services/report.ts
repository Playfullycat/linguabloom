import { and, asc, desc, eq, ne } from "drizzle-orm";

import type { DbExecutor } from "@/db/connection";
import { errorItems, pteAttempts } from "@/db/schema";

import { listMocks } from "./mock";
import { getCurrentVersion, listTaskTypes } from "./pte";

/**
 * PTE practice report (spec §5.13 “练习报告 / 练习趋势 / 技能交叉影响说明”).
 * Only objective points are averaged; AI-feedback tasks are counted but never
 * turned into a number. Nothing here predicts a Pearson score.
 */

export const REPORT_SKILLS = ["listening", "reading", "speaking", "writing"] as const;
export const REPORT_SKILL_LABELS: Record<(typeof REPORT_SKILLS)[number], string> = { listening: "听力", reading: "阅读", speaking: "口语", writing: "写作" };

export async function getPteReport(db: DbExecutor, userId: string) {
  const version = await getCurrentVersion(db);
  const types = await listTaskTypes(db, version.id);
  const attempts = await db
    .select({ taskCode: pteAttempts.taskCode, score: pteAttempts.score, maxScore: pteAttempts.maxScore, durationMs: pteAttempts.durationMs, timedOut: pteAttempts.timedOut, mode: pteAttempts.mode, createdAt: pteAttempts.createdAt })
    .from(pteAttempts)
    .where(eq(pteAttempts.userId, userId))
    .orderBy(asc(pteAttempts.createdAt));
  const share = (a: { score: number | null; maxScore: number | null }) => (a.maxScore && a.maxScore > 0 && a.score !== null ? a.score / a.maxScore : null);

  const byTask = types.map((t) => {
    const mine = attempts.filter((a) => a.taskCode === t.code);
    const shares = mine.map(share).filter((x): x is number => x !== null);
    const durations = mine.map((a) => a.durationMs).filter((x): x is number => x !== null && x > 0);
    return {
      code: t.code,
      section: t.section,
      nameZh: t.nameZh,
      skills: t.skills,
      objective: t.scoring.method !== "ai_traits",
      attempts: mine.length,
      avgShare: shares.length ? shares.reduce((s, x) => s + x, 0) / shares.length : null,
      best: shares.length ? Math.max(...shares) : null,
      /** Last 10 shares, oldest first (the trend). */
      recent: shares.slice(-10),
      avgSeconds: durations.length ? Math.round(durations.reduce((s, x) => s + x, 0) / durations.length / 1000) : null,
      timedOut: mine.filter((a) => a.timedOut).length,
    };
  });

  // Each skill: the task types that count towards it (cross-influence) and the average objective share over them.
  const bySkill = REPORT_SKILLS.map((skill) => {
    const contributing = byTask.filter((t) => t.skills.includes(skill));
    const scored = contributing.filter((t) => t.avgShare !== null);
    const weight = scored.reduce((s, t) => s + t.attempts, 0);
    return {
      skill,
      labelZh: REPORT_SKILL_LABELS[skill],
      contributing: contributing.map((t) => ({ code: t.code, nameZh: t.nameZh, alsoCounts: t.skills.filter((s) => s !== skill) })),
      avgShare: weight ? scored.reduce((s, t) => s + t.avgShare! * t.attempts, 0) / weight : null,
      practisedTypes: contributing.filter((t) => t.attempts > 0).length,
    };
  });

  const errors = await db
    .select({ id: errorItems.id, title: errorItems.title, count: errorItems.occurrenceCount, category: errorItems.category })
    .from(errorItems)
    .where(and(eq(errorItems.userId, userId), eq(errorItems.pointType, "pte"), ne(errorItems.status, "resolved")))
    .orderBy(desc(errorItems.occurrenceCount))
    .limit(6);

  return { version, byTask, bySkill, errors, mocks: await listMocks(db, userId), totalAttempts: attempts.length };
}
