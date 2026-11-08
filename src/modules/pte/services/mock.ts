import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/connection";
import { pteAttempts, pteMockTests, ptePrompts } from "@/db/schema";

import { SECTIONS, type Section } from "../content";
import type { FormCheck } from "../domain/scoring";
import { PteNotFoundError, PteRejectedError, getCurrentVersion, listTaskTypes, timeLimitFor } from "./pte";

/**
 * Mini mock tests (spec §5.13 “模拟练习”): one item per practisable task type
 * of a section, under one section clock. The clock can be paused — leaving
 * saves the time used — and the test resumes at the first unanswered item.
 * The time limit is the sum of each item's time (official where it exists,
 * otherwise this app's suggestion); this is a mini mock, not a full exam.
 */

export async function startOrResumeMock(db: DbExecutor, userId: string, section: Section, now = new Date()) {
  if (!SECTIONS.includes(section)) throw new PteRejectedError("没有这个部分。");
  const [open] = await db
    .select({ id: pteMockTests.id })
    .from(pteMockTests)
    .where(and(eq(pteMockTests.userId, userId), eq(pteMockTests.section, section), eq(pteMockTests.status, "in_progress")))
    .limit(1);
  if (open) return open.id;

  const version = await getCurrentVersion(db);
  const types = (await listTaskTypes(db, version.id)).filter((t) => t.section === section && t.practiceAvailable);
  // For each task type: the prompt this learner has done least (then the easiest).
  const counts = await db.execute<{ prompt_id: string; n: number }>(sql`
    select prompt_id, count(*)::int as n from pte_attempts where user_id = ${userId} group by prompt_id
  `);
  const done = new Map(counts.map((c) => [c.prompt_id, c.n]));
  const prompts = await db
    .select({ id: ptePrompts.id, taskCode: ptePrompts.taskCode, difficulty: ptePrompts.difficulty })
    .from(ptePrompts)
    .where(and(isNull(ptePrompts.archivedAt), inArray(ptePrompts.taskCode, types.map((t) => t.code))))
    .orderBy(asc(ptePrompts.difficulty), asc(ptePrompts.id));
  const items = types.flatMap((t) => {
    const pick = prompts.filter((p) => p.taskCode === t.code).sort((a, b) => (done.get(a.id) ?? 0) - (done.get(b.id) ?? 0))[0];
    return pick ? [{ promptId: pick.id, taskCode: t.code }] : [];
  });
  if (items.length === 0) throw new PteRejectedError("这个部分还没有可以练习的题目。");
  const limit = types.reduce((s, t) => s + timeLimitFor(t).seconds, 0);
  const [row] = await db
    .insert(pteMockTests)
    .values({ userId, examVersionId: version.id, section, items, timeLimitSeconds: limit, startedAt: now, updatedAt: now })
    .returning({ id: pteMockTests.id });
  return row!.id;
}

async function ownedMock(db: DbExecutor, userId: string, id: string) {
  const [m] = await db
    .select()
    .from(pteMockTests)
    .where(and(eq(pteMockTests.id, id), eq(pteMockTests.userId, userId)));
  if (!m) throw new PteNotFoundError(id);
  return m;
}

export type MockState = {
  id: string;
  section: Section;
  status: "in_progress" | "completed";
  items: { promptId: string; taskCode: string; attemptId: string | null }[];
  /** First unanswered item (null when all are answered or the test is over). */
  currentIndex: number | null;
  timeLimitSeconds: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  endReason: string | null;
};

export async function getMockState(db: DbExecutor, userId: string, id: string): Promise<MockState> {
  const m = await ownedMock(db, userId, id);
  const attempts = await db
    .select({ id: pteAttempts.id, promptId: pteAttempts.promptId })
    .from(pteAttempts)
    .where(and(eq(pteAttempts.userId, userId), eq(pteAttempts.mockTestId, m.id)));
  const byPrompt = new Map(attempts.map((a) => [a.promptId, a.id]));
  const items = m.items.map((i) => ({ ...i, attemptId: byPrompt.get(i.promptId) ?? null }));
  const current = m.status === "completed" ? -1 : items.findIndex((i) => !i.attemptId);
  return {
    id: m.id,
    section: m.section as Section,
    status: m.status as MockState["status"],
    items,
    currentIndex: current === -1 ? null : current,
    timeLimitSeconds: m.timeLimitSeconds,
    elapsedSeconds: m.elapsedSeconds,
    remainingSeconds: Math.max(0, m.timeLimitSeconds - m.elapsedSeconds),
    endReason: m.endReason,
  };
}

/**
 * Save the time used (the browser reports it while the test is open). Time
 * never goes backwards; reaching the limit ends the test, and so does
 * answering the last item.
 */
export async function saveMockProgress(db: DbExecutor, userId: string, id: string, elapsedSeconds: number, now = new Date()) {
  const m = await ownedMock(db, userId, id);
  if (m.status === "completed") return getMockState(db, userId, id);
  const elapsed = Math.min(m.timeLimitSeconds, Math.max(m.elapsedSeconds, Math.round(elapsedSeconds)));
  await db.update(pteMockTests).set({ elapsedSeconds: elapsed, updatedAt: now }).where(eq(pteMockTests.id, m.id));
  const state = await getMockState(db, userId, id);
  if (elapsed >= m.timeLimitSeconds) return finishMock(db, userId, id, "time_up", now);
  if (state.currentIndex === null) return finishMock(db, userId, id, "finished", now);
  return state;
}

export async function finishMock(db: DbExecutor, userId: string, id: string, reason: "finished" | "time_up", now = new Date()) {
  const m = await ownedMock(db, userId, id);
  if (m.status !== "completed") await db.update(pteMockTests).set({ status: "completed", endReason: reason, completedAt: now, updatedAt: now }).where(eq(pteMockTests.id, m.id));
  return getMockState(db, userId, id);
}

export type MockItemResult = {
  promptId: string;
  taskCode: string;
  taskNameZh: string;
  attemptId: string | null;
  score: number | null;
  maxScore: number | null;
  form: FormCheck | null;
  hasFeedback: boolean;
};

/** Results: each item, the objective total, and the objective share per skill the item counts for. */
export async function getMockResult(db: DbExecutor, userId: string, id: string) {
  const state = await getMockState(db, userId, id);
  const m = await ownedMock(db, userId, id);
  const types = new Map((await listTaskTypes(db, m.examVersionId)).map((t) => [t.code, t]));
  const attempts = await db
    .select()
    .from(pteAttempts)
    .where(and(eq(pteAttempts.userId, userId), eq(pteAttempts.mockTestId, m.id)));
  const byPrompt = new Map(attempts.map((a) => [a.promptId, a]));
  const items: MockItemResult[] = state.items.map((i) => {
    const a = byPrompt.get(i.promptId);
    return {
      promptId: i.promptId,
      taskCode: i.taskCode,
      taskNameZh: types.get(i.taskCode)?.nameZh ?? i.taskCode,
      attemptId: a?.id ?? null,
      score: a?.score ?? null,
      maxScore: a?.maxScore ?? null,
      form: ((a?.scoreDetail as { form?: FormCheck | null } | null)?.form ?? null) as FormCheck | null,
      hasFeedback: Boolean(a?.feedback),
    };
  });
  // Objective items count in the total; an unanswered objective item counts as 0.
  const objective = items.filter((i) => i.maxScore !== null || (!i.attemptId && types.get(i.taskCode)?.scoring.method !== "ai_traits"));
  const skills = new Map<string, { score: number; max: number }>();
  for (const i of objective) {
    const max = i.maxScore ?? 1;
    for (const s of types.get(i.taskCode)?.skills ?? []) {
      const cur = skills.get(s) ?? { score: 0, max: 0 };
      skills.set(s, { score: cur.score + (i.score ?? 0) / max, max: cur.max + 1 });
    }
  }
  return {
    state,
    items,
    answered: items.filter((i) => i.attemptId).length,
    objectiveShare: objective.length ? objective.reduce((s, i) => s + (i.score ?? 0) / (i.maxScore ?? 1), 0) / objective.length : null,
    bySkill: [...skills].map(([skill, v]) => ({ skill, share: v.max ? v.score / v.max : 0, items: v.max })),
    startedAt: m.startedAt,
    completedAt: m.completedAt,
  };
}

export async function listMocks(db: DbExecutor, userId: string, limit = 10) {
  return db
    .select({ id: pteMockTests.id, section: pteMockTests.section, status: pteMockTests.status, endReason: pteMockTests.endReason, startedAt: pteMockTests.startedAt, completedAt: pteMockTests.completedAt, elapsedSeconds: pteMockTests.elapsedSeconds, timeLimitSeconds: pteMockTests.timeLimitSeconds })
    .from(pteMockTests)
    .where(eq(pteMockTests.userId, userId))
    .orderBy(desc(pteMockTests.startedAt))
    .limit(limit);
}
