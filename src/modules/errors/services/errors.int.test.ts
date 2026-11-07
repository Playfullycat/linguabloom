import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/db/connection";
import { errorItems, errorOccurrences, skillEstimates, users } from "@/db/schema";
import { runSeeds } from "@/db/seed";
import { getTestDatabaseUrl, truncateAll } from "@/test/db";
import { recordStepAttempt } from "@/modules/curriculum/services/progress";
import { loadGrammar, type ExerciseContent } from "@/modules/grammar/content";
import { GrammarNotFoundError, answerExercise, getGrammarPoint, listGrammarPoints } from "@/modules/grammar/services/grammar";
import { answerQuestion, checkDictationAttempt } from "@/modules/materials/services/materials";
import { answerCard, getReviewQueue } from "@/modules/review/services/review";
import { addWordsFromLesson, setCardSuspended } from "@/modules/review/services/vocabulary";
import { getTodayPlan } from "@/modules/study-plan/services/plan";

import { ErrorItemNotFoundError, completeRound, errorSummary, getErrorItem, getPracticeSet, listErrors, resolveManually } from "./errors";

const url = getTestDatabaseUrl();
const { db, client } = createDb(url, { max: 4 });
const TZ = "Asia/Shanghai";
const grammar = loadGrammar();

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

function exercise(id: string): ExerciseContent {
  const [point, eid] = id.split(".");
  return grammar.find((p) => p.id === point)!.exercises.find((e) => e.id === eid)!;
}
function right(id: string): unknown {
  const e = exercise(id);
  switch (e.type) {
    case "choice":
      return { choice: e.answer };
    case "cloze":
    case "correction":
      return { text: e.answers[0] };
    case "order":
      return { tokens: e.answers[0]!.replace(/[.?!]/g, "").split(" ") };
    case "build":
      return { text: "x", checked: e.checklist_zh.map(() => true) };
  }
}
function wrong(id: string): unknown {
  const e = exercise(id);
  if (e.type === "choice") return { choice: (e.answer + 1) % e.options.length };
  if (e.type === "order") return { tokens: [...e.tokens] };
  return { text: "zzz" };
}
const answer = (userId: string, exerciseId: string, response: unknown, extra: Partial<Parameters<typeof answerExercise>[2]> = {}, now?: Date) =>
  answerExercise(db, userId, { exerciseId, response, clientRequestId: randomUUID(), context: "practice", ...extra }, now);

describe("grammar exercises", () => {
  it("scores every exercise type on the server", async () => {
    for (const id of ["be-verb.e1", "be-verb.e3", "be-verb.e5", "be-verb.e7", "articles.e3"]) {
      expect((await answer(userA, id, right(id))).isCorrect).toBe(true);
    }
    // Case, punctuation and contractions are forgiven.
    expect((await answer(userA, "be-verb.e5", { text: "my mother's very kind" })).isCorrect).toBe(true);
    const build = await answer(userA, "be-verb.e8", { text: "I'm thirty.", checked: [true, false, true] });
    expect(build).toMatchObject({ isCorrect: null, score: 0.67, errorRecorded: false });
    expect(build.modelAnswers.length).toBeGreaterThan(0);
    await expect(answer(userA, "be-verb.e1", { text: "wrong shape" })).rejects.toThrow();
    await expect(answer(userA, "nope.e1", { choice: 0 })).rejects.toBeInstanceOf(GrammarNotFoundError);
  });

  it("writes wrong practice answers to the error notebook, once per request", async () => {
    const requestId = randomUUID();
    const first = await answerExercise(db, userA, { exerciseId: "be-verb.e2", response: wrong("be-verb.e2"), clientRequestId: requestId, context: "practice" });
    expect(first).toMatchObject({ isCorrect: false, errorRecorded: true, correctAnswer: "are" });
    const again = await answerExercise(db, userA, { exerciseId: "be-verb.e2", response: wrong("be-verb.e2"), clientRequestId: requestId, context: "practice" });
    expect(again).toMatchObject({ duplicate: true, errorRecorded: false });
    const [item] = await listErrors(db, userA);
    expect(item).toMatchObject({ category: "agreement", pointType: "grammar", pointId: "be-verb", title: "be 动词 am / is / are", occurrenceCount: 1, status: "active", needsRemediation: false, canPractise: true });
    expect(await listErrors(db, userB)).toEqual([]);
  });

  it("shows mastery on the grammar map", async () => {
    for (const id of ["can.e1", "can.e2", "can.e3", "can.e4", "can.e5"]) await answer(userA, id, right(id));
    let map = await listGrammarPoints(db, userA);
    expect(map.find((p) => p.id === "can")).toMatchObject({ mastery: "mastered", attempts: 5, accuracy: 1 });
    expect(map.find((p) => p.id === "articles")!.mastery).toBe("not_started");
    expect(map.find((p) => p.id === "comparatives")!.mastery).toBe("planned");
    await answer(userA, "can.e6", wrong("can.e6"));
    map = await listGrammarPoints(db, userA);
    expect(map.find((p) => p.id === "can")!.mastery).toBe("weak");
    const page = await getGrammarPoint(db, userA, "can");
    expect(page.recentErrors).toHaveLength(1);
    expect(JSON.stringify(page.exercises)).not.toMatch(/"answers?"|model_answers/);
    expect((await getGrammarPoint(db, userA, "be-verb")).taughtIn.map((u) => u.id)).toContain("a1-u01-pronouns-be");
  });

  it("updates the grammar estimate from practice when there is enough evidence", async () => {
    const ids = grammar.filter((p) => p.status === "published").flatMap((p) => p.exercises.filter((e) => e.type !== "build").slice(0, 1).map((e) => `${p.id}.${e.id}`));
    for (const id of ids.slice(0, 7)) await answer(userA, id, right(id));
    expect(await db.select().from(skillEstimates).where(eq(skillEstimates.userId, userA))).toHaveLength(0); // 7 < 8
    for (const id of ids.slice(7, 9)) await answer(userA, id, right(id));
    const rows = await db.select().from(skillEstimates).where(eq(skillEstimates.userId, userA));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ skill: "grammar", source: "practice", estimatedLevel: "a1", confidence: "low", evidenceCount: 8 });
  });
});

describe("remediation and retest", () => {
  async function makeRecurring(userId: string) {
    await answer(userId, "articles.e1", wrong("articles.e1"));
    await answer(userId, "articles.e2", wrong("articles.e2"));
    const [item] = await listErrors(db, userId);
    return item!;
  }

  it("offers remediation after a repeat, then a retest with different exercises the next day, then resolves", async () => {
    const item = await makeRecurring(userA);
    expect(item).toMatchObject({ occurrenceCount: 2, needsRemediation: true });
    expect((await errorSummary(db, userA)).needsRemediation).toHaveLength(1);

    const set = await getPracticeSet(db, userA, item.id, "remediation");
    expect(set).toHaveLength(3);
    expect(set.slice(0, 2).sort()).toEqual(["articles.e1", "articles.e2"]); // the ones answered wrongly first
    await answer(userA, set[0]!, right(set[0]!), { context: "remediation", errorItemId: item.id });
    await answer(userA, set[1]!, wrong(set[1]!), { context: "remediation", errorItemId: item.id });
    await answer(userA, set[2]!, right(set[2]!), { context: "remediation", errorItemId: item.id });
    const now = new Date();
    const outcome = await completeRound(db, userA, { itemId: item.id, mode: "remediation", exerciseIds: set, timeZone: TZ }, now);
    expect(outcome).toMatchObject({ passed: true, correct: 2, total: 3, status: "retest" });
    expect(outcome.retestDueAt!.getTime()).toBeGreaterThan(now.getTime());
    // Remediation answers are judged by the round, not added as new occurrences.
    expect((await getErrorItem(db, userA, item.id)).item).toMatchObject({ occurrenceCount: 2, retestDue: false });

    const tomorrow = new Date(outcome.retestDueAt!.getTime() + 60_000);
    expect((await getErrorItem(db, userA, item.id, tomorrow)).item.retestDue).toBe(true);
    const retest = await getPracticeSet(db, userA, item.id, "retest");
    expect(retest).toHaveLength(2);
    expect(retest.some((id) => set.includes(id))).toBe(false);
    for (const id of retest) await answer(userA, id, right(id), { context: "retest", errorItemId: item.id }, tomorrow);
    expect(await completeRound(db, userA, { itemId: item.id, mode: "retest", exerciseIds: retest, timeZone: TZ }, tomorrow)).toMatchObject({ passed: true, status: "resolved" });

    // It comes back: reopened and counted as a recurrence.
    await answer(userA, "articles.e3", wrong("articles.e3"));
    expect((await getErrorItem(db, userA, item.id)).item).toMatchObject({ status: "active", recurredCount: 1, occurrenceCount: 3 });
  });

  it("sends a failed retest back to active and keeps rounds private", async () => {
    const item = await makeRecurring(userA);
    const set = await getPracticeSet(db, userA, item.id, "remediation");
    for (const id of set) await answer(userA, id, right(id), { context: "remediation", errorItemId: item.id });
    const passed = await completeRound(db, userA, { itemId: item.id, mode: "remediation", exerciseIds: set, timeZone: TZ });
    const later = new Date(passed.retestDueAt!.getTime() + 1000);
    const retest = await getPracticeSet(db, userA, item.id, "retest");
    await answer(userA, retest[0]!, right(retest[0]!), { context: "retest", errorItemId: item.id }, later);
    await answer(userA, retest[1]!, wrong(retest[1]!), { context: "retest", errorItemId: item.id }, later);
    expect(await completeRound(db, userA, { itemId: item.id, mode: "retest", exerciseIds: retest, timeZone: TZ }, later)).toMatchObject({ passed: false, status: "active" });

    await expect(getErrorItem(db, userB, item.id)).rejects.toBeInstanceOf(ErrorItemNotFoundError);
    await expect(answer(userB, "articles.e1", right("articles.e1"), { context: "remediation", errorItemId: item.id })).rejects.toBeInstanceOf(GrammarNotFoundError);
    await expect(resolveManually(db, userB, item.id)).rejects.toBeInstanceOf(ErrorItemNotFoundError);
    await resolveManually(db, userA, item.id);
    expect((await getErrorItem(db, userA, item.id)).item.status).toBe("resolved");
  });

  it("puts the recurring error into today's plan and marks it done once remediation passes", async () => {
    const item = await makeRecurring(userA);
    let plan = await getTodayPlan(db, userA);
    const task = plan.tasks.find((t) => t.kind === "remediation")!;
    expect(task).toMatchObject({ href: `/errors/${item.id}`, status: "pending" });
    expect(task.reason).toContain("出现 2 次");
    const set = await getPracticeSet(db, userA, item.id, "remediation");
    for (const id of set) await answer(userA, id, right(id), { context: "remediation", errorItemId: item.id });
    await completeRound(db, userA, { itemId: item.id, mode: "remediation", exerciseIds: set, timeZone: TZ }, new Date(Date.now() + 1000));
    plan = await getTodayPlan(db, userA);
    expect(plan.tasks.find((t) => t.kind === "remediation")!.status).toBe("done");
  });
});

describe("errors from lessons, review, reading and listening", () => {
  it("links a wrong grammar step to the grammar point the unit teaches", async () => {
    // a1-u01 lesson 1, s05: grammar multiple choice; option 0 ("I very tired.") is wrong.
    const r = await recordStepAttempt(db, userA, { lessonId: "a1-u01-pronouns-be-l1", stepKey: "s05", response: { choice: 0 }, clientRequestId: randomUUID() });
    expect(r.isCorrect).toBe(false);
    const [item] = await listErrors(db, userA);
    expect(item).toMatchObject({ pointType: "grammar", pointId: "be-verb", category: "agreement", occurrenceCount: 1, lastWrong: "I very tired.", lastCorrect: "I'm very tired." });
    expect(item!.practiceHref).toBe("/grammar/be-verb");
  });

  it("records a wrong typed review answer as a spelling error", async () => {
    await addWordsFromLesson(db, userA, "pre-a1-u03-hello-l1", ["hello"]);
    const { cards } = await getReviewQueue(db, userA, new Date(), TZ);
    const recognition = cards.find((c) => c.cardType === "recognition")!;
    await setCardSuspended(db, userA, recognition.id, true);
    const recall = (await getReviewQueue(db, userA, new Date(), TZ)).cards.find((c) => c.cardType === "recall")!;
    await answerCard(db, userA, { cardId: recall.id, rating: 3, clientRequestId: randomUUID(), typed: "helo" });
    const [item] = await listErrors(db, userA);
    expect(item).toMatchObject({ category: "spelling", pointType: "vocabulary", pointId: "pre-a1-u03-hello.hello", lastWrong: "helo" });
    expect(item!.practiceHref).toBe("/vocabulary/pre-a1-u03-hello.hello");
  });

  it("records comprehension and listening errors from materials", async () => {
    await answerQuestion(db, userA, { contentId: "rd-pa1-this-is-mia", questionId: "q1", choice: 2, clientRequestId: randomUUID() });
    await checkDictationAttempt(db, userA, { contentId: "ls-pa1-new-classmate", segmentSeq: 4, mode: "sentence", text: "how are you", clientRequestId: randomUUID() });
    const items = await listErrors(db, userA);
    expect(items.map((i) => i.category).sort()).toEqual(["comprehension", "listening"]);
    expect(items.find((i) => i.category === "comprehension")).toMatchObject({ pointType: "material", pointId: "rd-pa1-this-is-mia", practiceHref: "/reading/rd-pa1-this-is-mia", canPractise: false });
    const occ = await db.select().from(errorOccurrences).where(and(eq(errorOccurrences.userId, userA), eq(errorOccurrences.source, "listening")));
    expect(occ[0]).toMatchObject({ wrong: "how are you", correct: "How are you today?" });
    expect(await db.select().from(errorItems).where(eq(errorItems.userId, userB))).toHaveLength(0);
  });
});
