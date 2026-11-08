import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/db/connection";
import { learnerLessonProgress, lessonStepAttempts, users } from "@/db/schema";
import { runSeeds } from "@/db/seed";
import { getTestDatabaseUrl, truncateAll } from "@/test/db";

import { InvalidResponseError } from "../domain/scoring";
import { LessonIncompleteError, completeLesson, recordStepAttempt } from "./progress";
import { getLessonForPlayer, getUnit, listLevels } from "./queries";

const url = getTestDatabaseUrl();
const { db, client } = createDb(url, { max: 4 });
const LESSON = "pre-a1-u03-hello-l1";

let userA: string;
let userB: string;

beforeAll(async () => {
  await truncateAll(url);
  await runSeeds(url, () => {});
});

beforeEach(async () => {
  await db.delete(lessonStepAttempts);
  await db.delete(learnerLessonProgress);
  await db.delete(users);
  [{ id: userA }] = await db.insert(users).values({ name: "A", email: "a@example.test" }).returning({ id: users.id });
  [{ id: userB }] = await db.insert(users).values({ name: "B", email: "b@example.test" }).returning({ id: users.id });
});

afterAll(() => client.end());

const view = (stepKey: string) => ({ lessonId: LESSON, stepKey, response: { viewed: true }, clientRequestId: randomUUID() });

describe("recordStepAttempt", () => {
  it("scores on the server, appends attempts and moves the resume point", async () => {
    const wrong = await recordStepAttempt(db, userA, { lessonId: LESSON, stepKey: "s06", response: { choice: 0 }, clientRequestId: randomUUID() });
    expect(wrong).toMatchObject({ isCorrect: false, attemptNo: 1, correctAnswer: "Good afternoon.", nextStepKey: "s07" });

    const retry = await recordStepAttempt(db, userA, { lessonId: LESSON, stepKey: "s06", response: { choice: 1 }, clientRequestId: randomUUID() });
    expect(retry).toMatchObject({ isCorrect: true, attemptNo: 2 });

    const [progress] = await db.select().from(learnerLessonProgress).where(eq(learnerLessonProgress.userId, userA));
    expect(progress).toMatchObject({ status: "in_progress", currentStepKey: "s07" });
  });

  it("is idempotent for a retried request", async () => {
    const input = view("s01");
    const first = await recordStepAttempt(db, userA, input);
    const again = await recordStepAttempt(db, userA, input);
    expect(again).toMatchObject({ duplicate: true, attemptNo: first.attemptNo });
    const rows = await db.select().from(lessonStepAttempts).where(eq(lessonStepAttempts.userId, userA));
    expect(rows).toHaveLength(1);
  });

  it("rejects responses of the wrong shape without writing anything", async () => {
    await expect(
      recordStepAttempt(db, userA, { lessonId: LESSON, stepKey: "s06", response: { text: "x" }, clientRequestId: randomUUID() }),
    ).rejects.toBeInstanceOf(InvalidResponseError);
    expect(await db.select().from(lessonStepAttempts)).toHaveLength(0);
  });
});

describe("completeLesson", () => {
  it("refuses while assessed steps are missing", async () => {
    await recordStepAttempt(db, userA, view("s01"));
    await expect(completeLesson(db, userA, LESSON)).rejects.toBeInstanceOf(LessonIncompleteError);
  });

  it("completes with a first-try mastery estimate and a review list", async () => {
    const answers: Record<string, unknown> = {
      s06: { choice: 0 }, // wrong first try
      s07: {
        pairs: [
          { left: "Good morning!", right: "8:00 a.m. 见面" },
          { left: "Good afternoon!", right: "2:00 p.m. 见面" },
          { left: "Good evening!", right: "7:00 p.m. 见面" },
          { left: "Good night!", right: "11:00 p.m. 睡前" },
        ],
      },
      s08: { choice: 1 },
      s09: { text: "Morning" },
      s10: { choice: 1 },
    };
    for (const key of ["s01", "s02", "s03", "s04", "s05"]) await recordStepAttempt(db, userA, view(key));
    for (const [stepKey, response] of Object.entries(answers)) {
      await recordStepAttempt(db, userA, { lessonId: LESSON, stepKey, response, clientRequestId: randomUUID() });
    }
    // Correct retry does not change first-try mastery.
    await recordStepAttempt(db, userA, { lessonId: LESSON, stepKey: "s06", response: { choice: 1 }, clientRequestId: randomUUID() });

    const summary = await completeLesson(db, userA, LESSON);
    expect(summary.objectiveCount).toBe(5);
    expect(summary.firstTryCorrect).toBe(4);
    expect(summary.masteryEstimate).toBeCloseTo(0.8);
    expect(summary.toReview.map((r) => r.stepKey)).toEqual(["s06"]);
    expect(summary.vocabularyKeys).toContain("good-morning");

    const [progress] = await db
      .select()
      .from(learnerLessonProgress)
      .where(and(eq(learnerLessonProgress.userId, userA), eq(learnerLessonProgress.lessonId, LESSON)));
    expect(progress).toMatchObject({ status: "completed", completionRatio: 1 });
  });
});

describe("read models are scoped to the learner", () => {
  it("never show one learner's progress to another", async () => {
    await recordStepAttempt(db, userA, view("s01"));
    await recordStepAttempt(db, userA, { lessonId: LESSON, stepKey: "s06", response: { choice: 1 }, clientRequestId: randomUUID() });

    const forA = await getLessonForPlayer(db, userA, LESSON);
    const forB = await getLessonForPlayer(db, userB, LESSON);
    expect(forA?.progress.status).toBe("in_progress");
    expect(Object.keys(forA?.attempts ?? {})).toEqual(expect.arrayContaining(["s01", "s06"]));
    expect(forB?.progress.status).toBe("not_started");
    expect(forB?.attempts).toEqual({});

    const unitForB = await getUnit(db, userB, "pre-a1-u03-hello");
    expect(unitForB?.lessons.every((l) => l.status === "not_started")).toBe(true);
  });

  it("player data contains no answer keys and planned units are not playable", async () => {
    const lesson = await getLessonForPlayer(db, userA, LESSON);
    const scored = lesson!.steps.filter((s) => ["choice", "cloze", "order", "match"].includes(s.type));
    expect(scored.length).toBeGreaterThan(0);
    for (const step of scored) expect(Object.keys(step)).not.toEqual(expect.arrayContaining(["answer"]));
    expect(JSON.stringify(scored)).not.toMatch(/"answer"|"answers"|"explanation_zh"|"pairs"/);
    expect(await getUnit(db, userA, "pre-a1-u01-meet-english")).toMatchObject({ status: "planned", lessons: [] });
  });

  it("level overview counts only published lessons", async () => {
    const levels = await listLevels(db, userA);
    const preA1 = levels.find((l) => l.code === "pre_a1")!;
    expect(preA1.unitCount).toBe(8);
    expect(preA1.lessonCount).toBeGreaterThanOrEqual(4);
    // Units without content stay planned and are not counted as published.
    expect(levels.find((l) => l.code === "c2")).toMatchObject({ unitCount: 3, publishedUnitCount: 2 });
  });

  it("A2–C2 units are seeded as learnable lessons, and their scored steps score on the server (Phase 5.1–5.2)", async () => {
    const levels = await listLevels(db, userA);
    for (const code of ["a2", "b1", "b2", "c1", "c2"] as const) {
      const level = levels.find((l) => l.code === code)!;
      expect(level.publishedUnitCount, code).toBe(2);
      expect(level.lessonCount, code).toBe(8);
    }
    const lessonId = "b1-u02-conditionals-l2";
    const lesson = await getLessonForPlayer(db, userA, lessonId);
    expect(lesson?.steps.length).toBeGreaterThanOrEqual(10);
    // s05: "If it ___ tomorrow, we'll stay at home." — rains (index 0).
    const right = await recordStepAttempt(db, userA, { lessonId, stepKey: "s05", response: { choice: 0 }, clientRequestId: randomUUID() });
    const wrong = await recordStepAttempt(db, userA, { lessonId, stepKey: "s13", response: { choice: 0 }, clientRequestId: randomUUID() });
    expect(right.isCorrect).toBe(true);
    expect(wrong.isCorrect).toBe(false);
    expect(await getUnit(db, userA, "a2-u02-while-when")).toMatchObject({ status: "planned", lessons: [] });
  });
});
