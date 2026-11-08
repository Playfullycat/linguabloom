import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/db/connection";
import { canDoEvidence, canDoStatements, contentInteractions, exerciseAttempts, lessonStepAttempts, lessonSteps, reviewCards, reviewLogs, speakingAttempts, users, writingSubmissions } from "@/db/schema";
import { recordError } from "@/modules/errors/services/errors";
import { addWordsFromLesson } from "@/modules/review/services/vocabulary";
import { runSeeds } from "@/db/seed";
import { getTestDatabaseUrl, truncateAll } from "@/test/db";
import {
  answerAssessmentItem,
  completeAssessment,
  getAssessmentState,
  getEstimateHistory,
  listAssessmentHistory,
  skipAssessmentSkill,
  startOrResumeAssessment,
} from "@/modules/assessment/services/assessment";

import { getAbilityMap, summarizeAbilities, syncCanDoEvidence } from "./abilities";
import { getSkillAnalytics } from "./analytics";
import { getLearningTrends } from "./trends";

const url = getTestDatabaseUrl();
const { db, client } = createDb(url, { max: 4 });
let userA: string;
let userB: string;
const TZ = "Asia/Shanghai";

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

const daysAgo = (n: number, hour = 3) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

const item = async (user: string, id: string) => (await getAbilityMap(db, user, TZ)).find((i) => i.id === id)!;

describe("can-do statements", () => {
  it("are seeded from the units and the catalog with pass rules and evidence types", async () => {
    const rows = await db.select().from(canDoStatements);
    expect(rows.length).toBe(83);
    const be = rows.find((r) => r.id === "a1.gr.be")!;
    expect(be).toMatchObject({ level: "a1", skill: "grammar", origin: "unit:a1-u01-pronouns-be" });
    expect(be.evidenceTypes).toEqual(expect.arrayContaining(["lesson", "exercise"]));
    expect(rows.find((r) => r.id === "a2.sp.opinion")!.passRule).toMatchObject({ needsMedium: true });
  });
});

describe("evidence from practice", () => {
  it("grammar exercises: first attempt per day counts, retries the same day don't", async () => {
    const attempt = (isCorrect: boolean, at: Date, exerciseId = "be-verb.e1") =>
      db.insert(exerciseAttempts).values({ userId: userA, exerciseId, response: {}, score: isCorrect ? 1 : 0, isCorrect, context: "practice", clientRequestId: randomUUID(), createdAt: at });
    await attempt(false, daysAgo(3));
    await attempt(true, daysAgo(3, 4)); // retry, same day: ignored
    await attempt(true, daysAgo(2));
    await attempt(true, daysAgo(1), "be-verb.e2");
    expect(await syncCanDoEvidence(db, userA, TZ)).toBe(3);
    expect(await syncCanDoEvidence(db, userA, TZ)).toBe(0); // idempotent

    let be = await item(userA, "a1.gr.be");
    expect(be.result).toMatchObject({ status: "emerging", evidenceCount: 3, passWeight: 2 });
    expect(be.recent[0]).toMatchObject({ source: "exercise", outcome: "pass", href: "/grammar/be-verb" });

    await attempt(true, daysAgo(0), "be-verb.e3");
    be = await item(userA, "a1.gr.be");
    expect(be.result.status).toBe("shown");
    // Another learner sees none of it.
    expect((await item(userB, "a1.gr.be")).result.status).toBe("not_started");
  });

  it("lesson steps count for the lesson's statements of the same skill; self-rated steps are half weight", async () => {
    const steps = await db.select().from(lessonSteps).where(eq(lessonSteps.lessonId, "a1-u01-pronouns-be-l2"));
    const grammarStep = steps.find((s) => s.assessed && s.skill === "grammar" && s.stepType === "choice")!;
    const speakStep = steps.find((s) => s.skill === "spoken_production")!;
    const insert = (stepKey: string, values: { isCorrect?: boolean | null; selfScore?: number | null; attemptNo?: number }, at: Date) =>
      db.insert(lessonStepAttempts).values({ userId: userA, lessonId: "a1-u01-pronouns-be-l2", stepKey, attemptNo: values.attemptNo ?? 1, response: {}, isCorrect: values.isCorrect ?? null, selfScore: values.selfScore ?? null, clientRequestId: randomUUID(), createdAt: at });
    await insert(grammarStep.stepKey, { isCorrect: true }, daysAgo(2));
    await insert(grammarStep.stepKey, { isCorrect: true, attemptNo: 2 }, daysAgo(2, 4)); // second attempt: ignored
    await insert(speakStep.stepKey, { selfScore: 1 }, daysAgo(1));
    await syncCanDoEvidence(db, userA, TZ);
    const rows = await db.select().from(canDoEvidence).where(eq(canDoEvidence.userId, userA));
    expect(rows.map((r) => [r.canDoId, r.source, r.confidence, r.weight]).sort()).toEqual([
      ["a1.gr.be", "lesson_step", "medium", 1],
      ["a1.sp.describe-people", "lesson_step", "low", 0.5],
    ]);
    const sp = await item(userA, "a1.sp.describe-people");
    expect(sp.result.missing.join()).toContain("自评不算");
  });

  it("comprehension questions, speaking and writing feedback all count; deleting a session removes its evidence", async () => {
    await db.insert(contentInteractions).values([
      { userId: userA, contentId: "ls-a2-lost-phone", kind: "question", isCorrect: true, payload: { questionId: "q1" }, createdAt: daysAgo(2) },
      { userId: userA, contentId: "ls-a2-lost-phone", kind: "dictation", isCorrect: false, payload: {}, createdAt: daysAgo(1) },
    ]);
    const [sp] = await db
      .insert(speakingAttempts)
      .values({ userId: userA, taskType: "opinion", promptId: "sp-opinion-city", mode: "typed", provider: "mock", model: "m", level: "A2", saveTranscript: true, saveAudio: false, status: "ended", endedAt: daysAgo(1), evaluation: { task_completion: { rating: "met" }, comprehensibility: { rating: "clear" }, confidence: "medium" } })
      .returning({ id: speakingAttempts.id });
    await db.insert(writingSubmissions).values({ userId: userA, promptId: "w-a2-email-teacher", taskType: "email", task: {}, level: "A2", originalText: "Dear teacher", rubricVersion: "writing-v1", status: "feedback", confidence: "low", feedback: { task_completion: { rating: "partly" }, grammar: [{ category: "tense" }] } });
    await syncCanDoEvidence(db, userA, TZ);

    const listening = await item(userA, "a2.l.conversations");
    expect(listening.recent.map((r) => [r.source, r.outcome])).toEqual([
      ["dictation", "fail"],
      ["material_question", "pass"],
    ]);
    expect(listening.recent[1]!.href).toBe("/listening/ls-a2-lost-phone");
    const opinion = await item(userA, "a2.sp.opinion");
    expect(opinion.recent[0]).toMatchObject({ source: "speaking", outcome: "pass", confidence: "medium", href: `/speaking/attempts/${sp!.id}` });
    expect((await item(userA, "a2.wi.email")).recent[0]).toMatchObject({ source: "writing", outcome: "fail", confidence: "low" });

    await db.delete(speakingAttempts).where(eq(speakingAttempts.id, sp!.id));
    await syncCanDoEvidence(db, userA, TZ);
    expect(await db.select().from(canDoEvidence).where(and(eq(canDoEvidence.userId, userA), eq(canDoEvidence.source, "speaking")))).toHaveLength(0);

    const summary = summarizeAbilities(await getAbilityMap(db, userA, TZ));
    expect(summary.find((s) => s.level === "a2")).toMatchObject({ emerging: 2, shown: 0 });

    const analytics = await getSkillAnalytics(db, userA);
    expect(analytics.listening).toMatchObject({ answered: 1, correct: 1, dictation: { attempts: 1, correct: 0 } });
    expect(analytics.writing.texts).toBe(1);
  });
});

describe("long-term trends (Phase 5.3)", () => {
  it("counts study time, mature-card retention, new evidence per skill and errors per category by week, per learner", async () => {
    await addWordsFromLesson(db, userA, "pre-a1-u03-hello-l1", ["hello"]);
    const [card] = await db.select({ id: reviewCards.id }).from(reviewCards).where(eq(reviewCards.userId, userA)).limit(1);
    const now = new Date();
    // 12 reviews of a mature card this week, 11 remembered: 92% retention.
    await db.insert(reviewLogs).values(
      Array.from({ length: 12 }, (_, i) => ({
        userId: userA,
        cardId: card!.id,
        rating: i === 0 ? 1 : 3,
        reviewedAt: new Date(now.getTime() - i * 60_000),
        elapsedMs: 30_000,
        responseMode: "self",
        stateBefore: { state: 2 },
        schedulerResult: {},
        algorithmVersion: "test",
        clientRequestId: randomUUID(),
      })),
    );
    await db.insert(canDoEvidence).values({ userId: userA, canDoId: "a1.gr.be", source: "exercise", sourceRef: randomUUID(), outcome: "pass", confidence: "medium", weight: 1, occurredAt: now });
    await recordError(db, userA, { category: "tense", pointType: "grammar", pointId: "past-simple", title: "Past simple", source: "grammar", sourceRef: "x", wrong: "goed", correct: "went" });

    const trends = await getLearningTrends(db, userA, now, TZ);
    expect(trends.weeks).toHaveLength(8);
    const thisWeek = trends.weeks.at(-1)!;
    expect(thisWeek.matureReviews).toBe(12);
    expect(thisWeek.retention).toBeCloseTo(11 / 12);
    expect(thisWeek.minutes).toBeGreaterThanOrEqual(6); // 12 × 30 s
    expect(trends.weeks.slice(0, -1).every((w) => w.retention === null)).toBe(true); // < 10 reviews: not shown
    expect(trends.evidence.find((r) => r.key === "grammar")).toMatchObject({ total: 1 });
    expect(trends.errors).toEqual([expect.objectContaining({ key: "tense", label: "时态", total: 1 })]);
    expect(trends.correlation).toBeNull(); // one week of data is not enough

    const other = await getLearningTrends(db, userB, now, TZ);
    expect(other.weeks.every((w) => w.minutes === 0 && w.matureReviews === 0)).toBe(true);
    expect(other.evidence).toEqual([]);
    expect(other.errors).toEqual([]);
  });
});

describe("assessment history", () => {
  /** Answer up to `limit` items (all wrong), then finish. */
  async function runDiagnostic(limit = Infinity) {
    const sessionId = await startOrResumeAssessment(db, userA, null);
    let state = await getAssessmentState(db, userA, sessionId);
    const seen: string[] = [];
    while (state.current && seen.length < limit) {
      seen.push(state.current.item.id);
      state = (await answerAssessmentItem(db, userA, { sessionId, itemId: state.current.item.id, choice: 99, text: "zzz" })).state;
    }
    if (state.current) await skipAssessmentSkill(db, userA, sessionId, state.current.skill);
    await completeAssessment(db, userA, sessionId);
    return seen;
  }

  it("keeps every diagnostic; a retake prefers items not seen last time", async () => {
    const first = await runDiagnostic(1);
    const second = await runDiagnostic();
    // Same start level, but the item seen last time is passed over. (The bank is small —
    // 2–3 items per skill and level — so repeats can't always be avoided.)
    expect(first).toEqual(["voc-a1-1"]);
    expect(second[0]).not.toBe("voc-a1-1");
    expect(second[0]).toMatch(/^voc-a1-/);

    const history = await listAssessmentHistory(db, userA);
    expect(history).toHaveLength(2);
    expect(history[0]!.completedAt.getTime()).toBeGreaterThanOrEqual(history[1]!.completedAt.getTime());
    expect(history[0]!.estimates.map((e) => e.skill).sort()).toEqual(["grammar", "listening", "reading", "vocabulary"]);
    const points = await getEstimateHistory(db, userA);
    // One timeline point per estimate written by a diagnostic.
    expect(points.length).toBe(history.reduce((n, h) => n + h.estimates.length, 0));
    expect(await listAssessmentHistory(db, userB)).toEqual([]);
  });
});
