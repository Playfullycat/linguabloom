import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/db/connection";
import { fluencyAttempts, learningContents, skillEstimates, users } from "@/db/schema";
import { runSeeds } from "@/db/seed";
import { getTestDatabaseUrl, truncateAll } from "@/test/db";
import type { StoredContent } from "@/modules/materials/services/materials";
import { markCompleted } from "@/modules/materials/services/materials";
import { getWeeklyActivity } from "@/modules/study-plan/services/activity";
import { getTodayPlan, regenerateTodayPlan } from "@/modules/study-plan/services/plan";

import { FluencyInputError, MaterialNotFoundError, getFluencyText, listFluencyAttempts, listFluencyTexts, speedReadingHistory, submitFluencyAttempt } from "./fluency";

const url = getTestDatabaseUrl();
const { db, client } = createDb(url, { max: 4 });
const MIA = "rd-pa1-this-is-mia"; // 41 words, 3 questions
const BAG = "rd-pa1-my-bag"; // 53 words

let userA: string;
let userB: string;

async function answersFor(contentId: string, wrong = 0) {
  const [row] = await db.select({ content: learningContents.content }).from(learningContents).where(eq(learningContents.id, contentId));
  return (row!.content as StoredContent).questions.map((q, i) => ({ questionId: q.id, choice: i < wrong ? (q.answer + 1) % q.options.length : q.answer }));
}

const speed = async (userId: string, contentId: string, ms: number, wrong = 0, now?: Date) =>
  submitFluencyAttempt(db, userId, { kind: "speed_reading", contentId, clientRequestId: randomUUID(), rounds: [{ ms }], answers: await answersFor(contentId, wrong), durationMs: ms + 30_000 }, now);

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

describe("fluency texts", () => {
  it("offers only texts the learner finished or that are below their level", async () => {
    expect(await listFluencyTexts(db, userA)).toEqual([]); // a Pre-A1 beginner has nothing easier yet
    await markCompleted(db, userA, MIA);
    expect((await listFluencyTexts(db, userA)).map((t) => [t.id, t.why])).toEqual([[MIA, "completed"]]);
    expect(await listFluencyTexts(db, userB)).toEqual([]); // per learner

    // A reading estimate of A2 makes the Pre-A1 and A1 readings easy; listening stays at the placement level.
    await db.insert(skillEstimates).values({ userId: userA, skill: "reading", estimatedLevel: "a2", confidence: "medium", evidenceCount: 5, source: "test" });
    const texts = await listFluencyTexts(db, userA);
    expect(texts.every((t) => t.type === "reading" && (t.level === "pre_a1" || t.level === "a1"))).toBe(true);
    expect(texts).toHaveLength(4);
    expect(texts.find((t) => t.id === MIA)!.why).toBe("completed");
  });

  it("gives the practice text without answer keys, with cues and retelling limits", async () => {
    const t = await getFluencyText(db, userA, MIA);
    expect(t.wordCount).toBe(41);
    expect(t.questions).toHaveLength(3);
    expect(JSON.stringify(t.questions)).not.toContain("answer");
    expect(t.cues.length).toBeGreaterThanOrEqual(3);
    expect(t.retellLimitsMs).toEqual([60_000, 45_000, 30_000]);
    expect(t.notYetEasy).toBe(true);
    await markCompleted(db, userA, MIA);
    expect((await getFluencyText(db, userA, MIA)).notYetEasy).toBe(false);
    await expect(getFluencyText(db, userA, "rd-nope")).rejects.toBeInstanceOf(MaterialNotFoundError);
  });
});

describe("submitting fluency practice", () => {
  it("works out speed reading on the server, checks understanding and is idempotent", async () => {
    const answers = await answersFor(MIA);
    const input = { kind: "speed_reading" as const, contentId: MIA, clientRequestId: randomUUID(), rounds: [{ ms: 20_500 }], answers, durationMs: 40_000 };
    const r = await submitFluencyAttempt(db, userA, input);
    expect(r).toMatchObject({ kind: "speed_reading", wordCount: 41, correctCount: 3, questionCount: 3, counted: true, previousWpm: null, duplicate: false });
    expect(r.rounds).toEqual([{ ms: 20_500, wpm: 120 }]);
    expect(r.review.every((q) => q.isCorrect)).toBe(true);
    // A retry of the same request stores nothing new.
    const again = await submitFluencyAttempt(db, userA, input);
    expect(again).toMatchObject({ attemptId: r.attemptId, duplicate: true });
    expect(await db.select().from(fluencyAttempts)).toHaveLength(1);

    // Too little understanding: stored, but the speed does not count.
    const low = await speed(userA, MIA, 15_000, 2);
    expect(low).toMatchObject({ correctCount: 1, counted: false, previousWpm: 120 });
    const history = await speedReadingHistory(db, userA);
    expect(history.points.map((p) => p.wpm)).toEqual([120]);
    expect(history.notCounted).toBe(1);
    expect((await listFluencyAttempts(db, userA)).map((a) => a.counted)).toEqual([false, true]);
    expect(await listFluencyAttempts(db, userB)).toEqual([]);
  });

  it("rejects impossible speeds, missing answers, wrong round counts and over-long retelling", async () => {
    await expect(speed(userA, BAG, 3_000)).rejects.toBeInstanceOf(FluencyInputError); // over 1000 words a minute
    await expect(
      submitFluencyAttempt(db, userA, { kind: "speed_reading", contentId: MIA, clientRequestId: randomUUID(), rounds: [{ ms: 20_000 }], answers: [], durationMs: 20_000 }),
    ).rejects.toThrow("回答完所有理解题");
    await expect(
      submitFluencyAttempt(db, userA, { kind: "repeated_reading", contentId: MIA, clientRequestId: randomUUID(), rounds: [{ ms: 20_000 }], durationMs: 20_000 }),
    ).rejects.toThrow("轮数不对");
    await expect(
      submitFluencyAttempt(db, userA, { kind: "repeated_reading", contentId: MIA, clientRequestId: randomUUID(), rounds: [{ ms: 20_000 }, { ms: 1_000 }, { ms: 15_000 }], durationMs: 60_000 }),
    ).rejects.toThrow("用时不正常");
    const retell = (rounds: { ms: number; rating?: "smooth" | "ok" | "stuck" }[]) =>
      submitFluencyAttempt(db, userA, { kind: "timed_retell", contentId: MIA, clientRequestId: randomUUID(), rounds, durationMs: 200_000 });
    await expect(retell([{ ms: 60_000, rating: "ok" }, { ms: 45_000, rating: "ok" }, { ms: 30_000 }])).rejects.toThrow("感觉如何");
    await expect(retell([{ ms: 60_000, rating: "ok" }, { ms: 59_000, rating: "ok" }, { ms: 30_000, rating: "smooth" }])).rejects.toThrow("超过了限定时间");
    expect(await db.select().from(fluencyAttempts)).toHaveLength(0);
  });

  it("stores repeated reading and retelling rounds with speed gain and the time limits", async () => {
    const first = await submitFluencyAttempt(db, userA, {
      kind: "repeated_reading",
      contentId: MIA,
      clientRequestId: randomUUID(),
      rounds: [{ ms: 24_600 }, { ms: 20_500 }, { ms: 16_400 }],
      durationMs: 90_000,
    });
    expect(first.rounds.map((r) => r.wpm)).toEqual([100, 120, 150]);
    expect(first).toMatchObject({ gainPct: 33, previousWpm: null });
    const second = await submitFluencyAttempt(db, userA, { kind: "repeated_reading", contentId: MIA, clientRequestId: randomUUID(), rounds: [{ ms: 20_000 }, { ms: 18_000 }, { ms: 16_000 }], durationMs: 60_000 });
    expect(second.previousWpm).toBe(150);

    const retell = await submitFluencyAttempt(db, userA, {
      kind: "timed_retell",
      contentId: MIA,
      clientRequestId: randomUUID(),
      rounds: [{ ms: 60_000, rating: "stuck" }, { ms: 44_000, rating: "ok" }, { ms: 30_000, rating: "smooth" }],
      durationMs: 5 * 3_600_000,
    });
    expect(retell.rounds).toEqual([
      { ms: 60_000, limitMs: 60_000, rating: "stuck" },
      { ms: 44_000, limitMs: 45_000, rating: "ok" },
      { ms: 30_000, limitMs: 30_000, rating: "smooth" },
    ]);
    // Study time is capped (a tab left open is not study).
    const [row] = await db.select({ ms: fluencyAttempts.durationMs }).from(fluencyAttempts).where(eq(fluencyAttempts.id, retell.attemptId));
    expect(row!.ms).toBe(20 * 60_000);
  });

  it("hides another learner's imported text", async () => {
    await db.insert(learningContents).values({
      id: "imp-fl-b",
      type: "reading",
      titleEn: "B's text",
      titleZh: "B 的文本",
      summaryZh: "",
      cefrLevel: "pre_a1",
      difficultyMetadata: { wordCount: 10, sentenceCount: 2 },
      sourceType: "user_import",
      copyrightStatus: "personal_use_only",
      reviewStatus: "unreviewed",
      status: "published",
      ownerUserId: userB,
      content: { glossary: [], questions: [] },
      contentVersion: 1,
    });
    await expect(
      submitFluencyAttempt(db, userA, { kind: "repeated_reading", contentId: "imp-fl-b", clientRequestId: randomUUID(), rounds: [{ ms: 5_000 }, { ms: 5_000 }, { ms: 5_000 }], durationMs: 15_000 }),
    ).rejects.toBeInstanceOf(MaterialNotFoundError);
    await db.delete(learningContents).where(eq(learningContents.id, "imp-fl-b"));
  });
});

describe("fluency in the plan and the weekly activity", () => {
  it("adds a fluency task on a finished text, marks it done and counts the time as fluency", async () => {
    await markCompleted(db, userA, MIA);
    const plan = await getTodayPlan(db, userA);
    const task = plan.tasks.find((t) => t.kind === "fluency");
    expect(task).toMatchObject({ href: `/fluency/repeated_reading/${MIA}`, minutes: 5, status: "pending" });
    expect(plan.tasks.reduce((n, t) => n + t.minutes, 0)).toBe(25);

    await submitFluencyAttempt(db, userA, { kind: "repeated_reading", contentId: MIA, clientRequestId: randomUUID(), rounds: [{ ms: 30_000 }, { ms: 27_000 }, { ms: 24_000 }], durationMs: 120_000 });
    expect((await getTodayPlan(db, userA)).tasks.find((t) => t.kind === "fluency")!.status).toBe("done");

    const week = await getWeeklyActivity(db, userA, new Date(), "UTC");
    expect(week.byStrand.fluency_development).toBe(2);
    expect(week.lastActivityAt).not.toBeNull();

    // Already practised today: a rebuilt plan doesn't ask for more.
    await regenerateTodayPlan(db, userA, { sessionMinutes: 40 });
    expect((await getTodayPlan(db, userA)).tasks.some((t) => t.kind === "fluency")).toBe(false);
  });
});
