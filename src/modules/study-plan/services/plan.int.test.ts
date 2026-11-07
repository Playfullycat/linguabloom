import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/db/connection";
import { learnerLessonProgress, learningContents, lessonStepAttempts, reviewLogs, skillEstimates, studyPlanTasks, userContentState, users } from "@/db/schema";
import { runSeeds } from "@/db/seed";
import { getTestDatabaseUrl, truncateAll } from "@/test/db";
import { loadItemBank } from "@/modules/assessment/content";
import {
  AssessmentItemRejectedError,
  AssessmentSessionNotFoundError,
  answerAssessmentItem,
  completeAssessment,
  getAssessmentState,
  getCurrentEstimates,
  skipAssessmentSkill,
  startOrResumeAssessment,
} from "@/modules/assessment/services/assessment";
import { getLearnerSettings, setOnboardingStep, updatePreferences, updateProfile } from "@/modules/learner/services/profile";
import { getReviewQueue } from "@/modules/review/services/review";
import { addWordsFromLesson } from "@/modules/review/services/vocabulary";

import { getWeeklyActivity } from "./activity";
import { PlanTaskNotFoundError, getTodayPlan, moveTask, regenerateTodayPlan, restoreTask, skipTask } from "./plan";

const url = getTestDatabaseUrl();
const { db, client } = createDb(url, { max: 4 });
const TZ = "Asia/Shanghai";
const L1 = "pre-a1-u03-hello-l1";
const bank = loadItemBank();

let userA: string;
let userB: string;

beforeAll(async () => {
  await truncateAll(url);
  await runSeeds(url, () => {});
});

beforeEach(async () => {
  await db.delete(users);
  [{ id: userA }] = await db.insert(users).values({ name: "A", email: "a@example.test" }).returning({ id: users.id });
  [{ id: userB }] = await db.insert(users).values({ name: "B", email: "b@example.test" }).returning({ id: users.id });
});

afterAll(() => client.end());

const correctResponse = (itemId: string) => {
  const item = bank.items.find((i) => i.id === itemId)!;
  return item.type === "choice" ? { choice: item.answer } : { text: item.answers[0]! };
};

describe("learner profile", () => {
  it("creates defaults lazily and validates updates", async () => {
    const { profile, preferences } = await getLearnerSettings(db, userA);
    expect(profile).toMatchObject({ explanationLanguage: "zh", timezone: "Asia/Shanghai", onboardingStep: "welcome", onboardingCompletedAt: null });
    expect(preferences).toMatchObject({ dailyMinutes: 25, weeklyDays: 5, newItemsLimit: 20 });

    await updateProfile(db, userA, { learningGoals: ["travel", "travel", "work"], explanationLanguage: "mixed" });
    await updatePreferences(db, userA, { dailyMinutes: 40, weeklyDays: 3 });
    await setOnboardingStep(db, userA, "schedule");
    const after = await getLearnerSettings(db, userA);
    expect(after.profile).toMatchObject({ learningGoals: ["travel", "work"], explanationLanguage: "mixed", onboardingStep: "schedule" });
    expect(after.preferences).toMatchObject({ dailyMinutes: 40, weeklyDays: 3 });

    await expect(updatePreferences(db, userA, { dailyMinutes: 30 as never })).rejects.toThrow();
    await expect(updateProfile(db, userA, { timezone: "Mars/Olympus" })).rejects.toThrow();
    expect((await getLearnerSettings(db, userB)).preferences.dailyMinutes).toBe(25);
  });

  it("applies the learner's new-card limit to the review queue", async () => {
    await addWordsFromLesson(db, userA, L1, ["hello", "hi", "good-morning", "good-afternoon"]);
    await updatePreferences(db, userA, { newItemsLimit: 2 });
    const { newItemsLimit } = (await getLearnerSettings(db, userA)).preferences;
    const queue = await getReviewQueue(db, userA, new Date(), TZ, newItemsLimit);
    expect(queue.cards).toHaveLength(2);
    expect(queue.newBudget).toBe(2);
  });
});

describe("placement diagnostic", () => {
  it("adapts, scores on the server, supports skip and resume, and writes estimates", async () => {
    const sessionId = await startOrResumeAssessment(db, userA, "forgot");
    expect(await startOrResumeAssessment(db, userA, "forgot")).toBe(sessionId); // resume, not a second session

    let state = await getAssessmentState(db, userA, sessionId);
    expect(state.current).toMatchObject({ skill: "vocabulary", index: 1 });
    expect(state.current!.item.level).toBe("a1");
    expect(JSON.stringify(state.current!.item)).not.toMatch(/"answers?"|explanation_zh/);

    // Answer every vocabulary and grammar item correctly.
    while (state.current && (state.current.skill === "vocabulary" || state.current.skill === "grammar")) {
      const itemId = state.current.item.id;
      const result = await answerAssessmentItem(db, userA, { sessionId, itemId, ...correctResponse(itemId) });
      expect(result.isCorrect).toBe(true);
      state = result.state;
    }
    expect(state.current!.skill).toBe("reading");

    // A wrong answer is recorded as wrong; a retried request is not stored twice.
    const readingItem = state.current!.item.id;
    const wrong = await answerAssessmentItem(db, userA, { sessionId, itemId: readingItem, choice: 99, text: "zzz" });
    expect(wrong.isCorrect).toBe(false);
    expect(wrong.correctAnswer.length).toBeGreaterThan(0);
    const retry = await answerAssessmentItem(db, userA, { sessionId, itemId: readingItem, ...correctResponse(readingItem) });
    expect(retry).toMatchObject({ isCorrect: false, duplicate: true });

    // Only the current item can be answered.
    const notCurrent = bank.items.find((i) => i.skill === "listening")!.id;
    await expect(answerAssessmentItem(db, userA, { sessionId, itemId: notCurrent, choice: 0 })).rejects.toBeInstanceOf(AssessmentItemRejectedError);

    await skipAssessmentSkill(db, userA, sessionId, "reading");
    await skipAssessmentSkill(db, userA, sessionId, "listening");
    state = await getAssessmentState(db, userA, sessionId);
    expect(state.current).toBeNull();
    expect(state.skills.map((s) => s.status)).toEqual(["done", "done", "skipped", "skipped"]);

    const result = await completeAssessment(db, userA, sessionId);
    expect(result.estimates.map((e) => e.skill)).toEqual(["vocabulary", "grammar", "reading"]);
    expect(result.estimates[0]!.estimate).toMatchObject({ level: "b1", confidence: "medium", evidenceCount: 6, mayBeHigher: true });
    expect(result.estimates[2]!.estimate).toMatchObject({ confidence: "low", evidenceCount: 1 });
    expect(result.skipped).toEqual(["reading", "listening"]);

    await completeAssessment(db, userA, sessionId); // idempotent
    expect(await db.select().from(skillEstimates).where(eq(skillEstimates.userId, userA))).toHaveLength(3);
    const current = await getCurrentEstimates(db, userA);
    expect(current.find((e) => e.skill === "grammar")).toMatchObject({ level: "b1", source: `assessment:${sessionId}` });
    expect(current.every((e) => e.confidence !== "high")).toBe(true);
  });

  it("starts beginners at Pre-A1 and keeps sessions private", async () => {
    const sessionId = await startOrResumeAssessment(db, userA, "beginner");
    expect((await getAssessmentState(db, userA, sessionId)).current!.item.level).toBe("pre_a1");
    await expect(getAssessmentState(db, userB, sessionId)).rejects.toBeInstanceOf(AssessmentSessionNotFoundError);
    await expect(skipAssessmentSkill(db, userB, sessionId, "grammar")).rejects.toBeInstanceOf(AssessmentSessionNotFoundError);
  });
});

describe("today plan", () => {
  it("starts a new learner on the first lesson and persists the plan for the day", async () => {
    const now = new Date();
    const plan = await getTodayPlan(db, userA, now);
    expect(plan.sessionMinutes).toBe(25);
    expect(plan.comeback).toBe(false);
    expect(plan.tasks.map((t) => t.kind)).toEqual(["lesson"]);
    expect(plan.tasks[0]).toMatchObject({ href: `/lesson/${L1}`, status: "pending", minutes: 25 });

    const again = await getTodayPlan(db, userA, now);
    expect(again.tasks.map((t) => t.id)).toEqual(plan.tasks.map((t) => t.id));
  });

  it("uses the placement estimate before any lesson is started", async () => {
    const sessionId = await startOrResumeAssessment(db, userA, "read_simple");
    let state = await getAssessmentState(db, userA, sessionId);
    while (state.current && state.current.skill !== "reading") {
      const itemId = state.current.item.id;
      state = (await answerAssessmentItem(db, userA, { sessionId, itemId, ...correctResponse(itemId) })).state;
    }
    await completeAssessment(db, userA, sessionId);
    const plan = await getTodayPlan(db, userA);
    const lesson = plan.tasks.find((t) => t.kind === "lesson")!;
    expect(lesson.href).toMatch(/^\/lesson\/a1-/);
    expect(lesson.reason).toContain("初步估计");
  });

  it("puts due reviews first, supports skip/restore, reorder and review-only mode", async () => {
    await addWordsFromLesson(db, userA, L1, ["hello", "hi"]);
    await regenerateTodayPlan(db, userA, { sessionMinutes: 40 });
    let plan = await getTodayPlan(db, userA);
    expect(plan.sessionMinutes).toBe(40);
    expect(plan.tasks.map((t) => t.kind)).toEqual(["review", "lesson"]);
    expect(plan.tasks.reduce((s, t) => s + t.minutes, 0)).toBe(40);

    const [review, lesson] = plan.tasks;
    await moveTask(db, userA, lesson!.id, "up");
    plan = await getTodayPlan(db, userA);
    expect(plan.tasks.map((t) => t.kind)).toEqual(["lesson", "review"]);

    await skipTask(db, userA, review!.id, "too_tired");
    await expect(skipTask(db, userB, lesson!.id, "other")).rejects.toBeInstanceOf(PlanTaskNotFoundError);
    plan = await getTodayPlan(db, userA);
    expect(plan.tasks.find((t) => t.kind === "review")).toMatchObject({ status: "skipped", skipReason: "too_tired" });

    // Regenerating keeps the skip.
    await regenerateTodayPlan(db, userA, { sessionMinutes: 25 });
    plan = await getTodayPlan(db, userA);
    const skipped = plan.tasks.find((t) => t.kind === "review")!;
    expect(skipped.status).toBe("skipped");
    await restoreTask(db, userA, skipped.id);
    expect((await getTodayPlan(db, userA)).tasks.find((t) => t.kind === "review")!.status).toBe("pending");

    await regenerateTodayPlan(db, userA, { mode: "review_only" });
    plan = await getTodayPlan(db, userA);
    expect(plan.mode).toBe("review_only");
    expect(plan.tasks.map((t) => t.kind)).toEqual(["review"]);
    expect(plan.tasks[0]!.reason).toContain("只复习");
  });

  it("derives done from real activity, never from a checkbox", async () => {
    const plan = await getTodayPlan(db, userA);
    expect(plan.tasks[0]!.status).toBe("pending");
    await db.insert(learnerLessonProgress).values({ userId: userA, lessonId: L1, status: "completed", completedAt: new Date(), completionRatio: 1 });
    expect((await getTodayPlan(db, userA)).tasks[0]!.status).toBe("done");
    expect((await getTodayPlan(db, userB)).tasks[0]!.status).toBe("pending");
    expect(await db.select().from(studyPlanTasks)).toHaveLength(2);
  });

  it("counts practice only after the task was recommended", async () => {
    const attempt = (createdAt: Date) => ({
      userId: userA,
      lessonId: L1,
      stepKey: "s02", // listening step
      attemptNo: 1,
      response: { viewed: true },
      clientRequestId: randomUUID(),
      createdAt,
    });
    // With every graded material finished, the input block falls back to re-listening a lesson.
    const materials = await db.select({ id: learningContents.id }).from(learningContents);
    await db.insert(userContentState).values(materials.map((m) => ({ userId: userA, contentId: m.id, completedAt: new Date(Date.now() - 10_000) })));
    await db.insert(learnerLessonProgress).values({ userId: userA, lessonId: L1, status: "completed", completedAt: new Date(Date.now() - 5_000), completionRatio: 1 });
    await db.insert(lessonStepAttempts).values(attempt(new Date(Date.now() - 2_000)));
    await regenerateTodayPlan(db, userA, { sessionMinutes: 60 });
    const input = () => getTodayPlan(db, userA).then((p) => p.tasks.find((t) => t.kind === "input")!);
    expect((await input()).status).toBe("pending");
    await db.insert(lessonStepAttempts).values(attempt(new Date(Date.now() + 1_000)));
    expect((await input()).status).toBe("done");
  });

  it("lightens the plan after a break of more than two days", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 5 * 86_400_000);
    await db.insert(lessonStepAttempts).values({ userId: userA, lessonId: L1, stepKey: "s01", attemptNo: 1, response: { viewed: true }, clientRequestId: randomUUID(), createdAt: old });
    await updatePreferences(db, userA, { dailyMinutes: 40 });
    const plan = await getTodayPlan(db, userA, now);
    expect(plan.comeback).toBe(true);
    expect(plan.tasks.reduce((s, t) => s + t.minutes, 0)).toBe(25);
  });
});

describe("weekly activity", () => {
  it("sums capped study time by strand and day", async () => {
    const now = new Date();
    await db.insert(lessonStepAttempts).values([
      { userId: userA, lessonId: L1, stepKey: "s02", attemptNo: 1, response: { viewed: true }, durationMs: 120_000, clientRequestId: randomUUID(), createdAt: now },
      { userId: userA, lessonId: L1, stepKey: "s01", attemptNo: 1, response: { viewed: true }, durationMs: 3_600_000, clientRequestId: randomUUID(), createdAt: now },
    ]);
    await addWordsFromLesson(db, userA, L1, ["hello"]);
    const [card] = await getReviewQueue(db, userA, new Date(), TZ).then((q) => q.cards);
    await db.insert(reviewLogs).values({
      userId: userA,
      cardId: card!.id,
      rating: 3,
      reviewedAt: now,
      elapsedMs: 30_000,
      responseMode: "self",
      stateBefore: { state: 0 },
      schedulerResult: {},
      algorithmVersion: "test",
      clientRequestId: randomUUID(),
    });

    const week = await getWeeklyActivity(db, userA, now, TZ);
    expect(week.days).toHaveLength(7);
    expect(week.days.at(-1)!.minutes).toBe(7.5); // 2 + 5 (capped) + 0.5
    expect(week.byStrand.meaning_focused_input).toBe(2); // s02 is a listening step
    expect(week.byStrand.meaning_focused_output).toBe(5); // s01 is a spoken interaction step
    expect(week.byStrand.language_focused_learning).toBe(0.5);
    expect(week.activeDaysThisWeek).toBe(1);
    expect((await getWeeklyActivity(db, userB, now, TZ)).totalMinutes).toBe(0);
  });
});
