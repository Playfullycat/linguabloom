import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/db/connection";
import { contentInteractions, learningContents, reviewCards, userVocabulary, users } from "@/db/schema";
import { runSeeds } from "@/db/seed";
import { getTestDatabaseUrl, truncateAll } from "@/test/db";
import { addWordsFromLesson } from "@/modules/review/services/vocabulary";
import { getWeeklyActivity } from "@/modules/study-plan/services/activity";
import { getTodayPlan, regenerateTodayPlan } from "@/modules/study-plan/services/plan";

import {
  MaterialNotFoundError,
  answerQuestion,
  checkDictationAttempt,
  collectWord,
  getMaterialForReader,
  listMaterials,
  lookupWord,
  markCompleted,
  recordEvent,
  saveNote,
  setFavorite,
  toggleSavedSegment,
} from "./materials";

const url = getTestDatabaseUrl();
const { db, client } = createDb(url, { max: 4 });
const MIA = "rd-pa1-this-is-mia";
const CLASSMATE = "ls-pa1-new-classmate";

let userA: string;
let userB: string;

beforeAll(async () => {
  await truncateAll(url);
  await runSeeds(url, () => {});
});

beforeEach(async () => {
  await db.delete(users);
  await db.delete(learningContents).where(eq(learningContents.sourceType, "user_import"));
  [{ id: userA }] = await db.insert(users).values({ name: "A", email: "a@example.test" }).returning({ id: users.id });
  [{ id: userB }] = await db.insert(users).values({ name: "B", email: "b@example.test" }).returning({ id: users.id });
});

afterAll(() => client.end());

describe("material lists", () => {
  it("lists built-in materials with a difficulty hint for this learner", async () => {
    const { materials, learner } = await listMaterials(db, userA, "reading");
    expect(learner.level).toBe("pre_a1");
    expect(materials).toHaveLength(8);
    expect(materials.find((m) => m.id === MIA)).toMatchObject({ fit: "right", completed: false, newWords: 9 });
    expect(materials.find((m) => m.level === "a1")!.fit).toBe("stretch");
    expect(materials.find((m) => m.level === "a2")!.fit).toBe("hard");
    expect((await listMaterials(db, userA, "listening")).materials.every((m) => m.type === "listening")).toBe(true);
  });

  it("hides another learner's imported material", async () => {
    await db.insert(learningContents).values({
      id: "imp-b-1",
      type: "reading",
      titleEn: "Private",
      titleZh: "私人",
      summaryZh: "导入",
      cefrLevel: "a1",
      difficultyMetadata: { wordCount: 3, sentenceCount: 1 },
      sourceType: "user_import",
      copyrightStatus: "personal_use_only",
      reviewStatus: "unreviewed",
      status: "published",
      ownerUserId: userB,
      content: { glossary: [], questions: [] },
      contentVersion: 1,
    });
    expect((await listMaterials(db, userA, "reading")).materials.some((m) => m.id === "imp-b-1")).toBe(false);
    expect((await listMaterials(db, userB, "reading")).materials.some((m) => m.id === "imp-b-1")).toBe(true);
    await expect(getMaterialForReader(db, userA, "imp-b-1")).rejects.toBeInstanceOf(MaterialNotFoundError);
  });
});

describe("reader", () => {
  it("sends sentences as tappable tokens, but no answer keys", async () => {
    const m = await getMaterialForReader(db, userA, MIA);
    expect(m.segments).toHaveLength(9);
    expect(m.segments[1]!.tokens.find((t) => t.kind === "word" && t.text === "years old")).toMatchObject({ gloss: "years-old" });
    const json = JSON.stringify(m.questions);
    expect(json).not.toMatch(/"answer"|explanation_zh/);
    expect(m.questions.every((q) => q.answered === null)).toBe(true);
    const listening = await getMaterialForReader(db, userA, CLASSMATE);
    expect(listening.segments.some((s) => s.keyword)).toBe(true);
  });

  it("looks words up in the glossary, then in course vocabulary, and logs every lookup", async () => {
    const glossary = await lookupWord(db, userA, MIA, "friend", "friend", 3);
    expect(glossary).toMatchObject({ source: "glossary", zh: "朋友", entryId: `${MIA}.friend`, collected: false, exampleEn: "This is my friend Ben." });
    const course = await lookupWord(db, userA, MIA, "Hello", null, 0);
    expect(course.source).toBe("course");
    expect(course.entryId).toMatch(/^pre-a1-u03-hello\./);
    const none = await lookupWord(db, userA, MIA, "Mia", null, 0);
    expect(none).toMatchObject({ source: "none", entryId: null });
    const logs = await db.select().from(contentInteractions).where(and(eq(contentInteractions.userId, userA), eq(contentInteractions.kind, "lookup")));
    expect(logs).toHaveLength(3);
  });

  it("collects a word into review once, and never duplicates a word already learned", async () => {
    expect(await collectWord(db, userA, MIA, `${MIA}.friend`)).toEqual({ added: true });
    expect(await collectWord(db, userA, MIA, `${MIA}.friend`)).toEqual({ added: false });
    const [vocab] = await db.select().from(userVocabulary).where(eq(userVocabulary.entryId, `${MIA}.friend`));
    expect(vocab).toMatchObject({ userId: userA, addedFrom: `material:${MIA}` });
    expect(await db.select().from(reviewCards).where(eq(reviewCards.entryId, `${MIA}.friend`))).toHaveLength(2);
    expect((await lookupWord(db, userA, MIA, "friend", "friend", null)).collected).toBe(true);
    expect((await listMaterials(db, userA, "reading")).materials.find((m) => m.id === MIA)!.newWords).toBe(8);

    // "hello" learned in a lesson: collecting the same word from a material adds nothing.
    await addWordsFromLesson(db, userA, "pre-a1-u03-hello-l1", ["hello"]);
    const hello = await lookupWord(db, userA, MIA, "Hello", null, 0);
    expect(hello.collected).toBe(true);
    expect(await collectWord(db, userA, MIA, hello.entryId!)).toEqual({ added: false });

    // Only this material's glossary (or course words) can be collected from here.
    await expect(collectWord(db, userA, MIA, "rd-a1-my-morning.office")).rejects.toBeInstanceOf(MaterialNotFoundError);
    expect(await db.select().from(userVocabulary).where(eq(userVocabulary.userId, userB))).toHaveLength(0);
  });

  it("scores comprehension questions on the server, idempotently", async () => {
    const id = randomUUID();
    const wrong = await answerQuestion(db, userA, { contentId: MIA, questionId: "q1", choice: 2, clientRequestId: id });
    expect(wrong).toMatchObject({ isCorrect: false, correctAnswer: "十岁", segment: 1, duplicate: false });
    expect(await answerQuestion(db, userA, { contentId: MIA, questionId: "q1", choice: 0, clientRequestId: id })).toMatchObject({ isCorrect: false, duplicate: true });
    await answerQuestion(db, userA, { contentId: MIA, questionId: "q1", choice: 0, clientRequestId: randomUUID() });
    const m = await getMaterialForReader(db, userA, MIA);
    expect(m.questions[0]!.answered).toMatchObject({ choice: 0, isCorrect: true, correctAnswer: "十岁" });
    expect((await getMaterialForReader(db, userB, MIA)).questions[0]!.answered).toBeNull();
  });

  it("checks sentence dictation and key-word listening", async () => {
    const sentence = await checkDictationAttempt(db, userA, { contentId: CLASSMATE, segmentSeq: 0, mode: "sentence", text: "hi im anna", clientRequestId: randomUUID() });
    expect(sentence.isCorrect).toBe(true);
    const missed = await checkDictationAttempt(db, userA, { contentId: CLASSMATE, segmentSeq: 4, mode: "sentence", text: "how are you", clientRequestId: randomUUID() });
    expect(missed.isCorrect).toBe(false);
    expect(missed.words.at(-1)).toMatchObject({ word: "today", status: "missing" });
    const reader = await getMaterialForReader(db, userA, CLASSMATE);
    const seg = reader.segments.find((s) => s.keyword)!;
    const expected = seg.en.slice(seg.keyword!.before.length, seg.keyword!.before.length + seg.keyword!.length);
    const kw = await checkDictationAttempt(db, userA, { contentId: CLASSMATE, segmentSeq: seg.sequence, mode: "keyword", text: expected.toUpperCase(), clientRequestId: randomUUID() });
    expect(kw).toMatchObject({ isCorrect: true, expected });
    const logged = await db.select().from(contentInteractions).where(eq(contentInteractions.userId, userA));
    expect(logged.map((l) => l.kind).sort()).toEqual(["dictation", "dictation", "keyword"]);
  });

  it("keeps favourite, note, saved sentences and completion per learner", async () => {
    await setFavorite(db, userA, MIA, true);
    await saveNote(db, userA, MIA, "  years old = 岁  ");
    expect(await toggleSavedSegment(db, userA, MIA, 3)).toEqual([3]);
    expect(await toggleSavedSegment(db, userA, MIA, 1)).toEqual([1, 3]);
    expect(await toggleSavedSegment(db, userA, MIA, 3)).toEqual([1]);
    await markCompleted(db, userA, MIA);
    const m = await getMaterialForReader(db, userA, MIA);
    expect(m.state).toEqual({ favorite: true, note: "years old = 岁", savedSegments: [1], completed: true });
    expect((await getMaterialForReader(db, userB, MIA)).state.favorite).toBe(false);
    expect((await listMaterials(db, userA, "reading")).materials.find((m) => m.id === MIA)).toMatchObject({ completed: true, favorite: true });
  });
});

describe("plan and study time", () => {
  it("puts a suitable unfinished material in the input block and marks it done when finished", async () => {
    await regenerateTodayPlan(db, userA, { sessionMinutes: 60 });
    let plan = await getTodayPlan(db, userA);
    const input = plan.tasks.find((t) => t.kind === "input")!;
    expect(input.href).toMatch(/^\/(reading|listening)\/(rd|ls)-pa1-/);
    expect(input.reason).toContain("Pre-A1");
    expect(input.status).toBe("pending");
    await markCompleted(db, userA, input.href.split("/")[2]!, new Date(Date.now() + 1_000));
    plan = await getTodayPlan(db, userA);
    expect(plan.tasks.find((t) => t.kind === "input")!.status).toBe("done");
  });

  it("counts active time on materials as meaning-focused input, capped per slice", async () => {
    await recordEvent(db, userA, { contentId: MIA, kind: "time", durationMs: 45_000 });
    await recordEvent(db, userA, { contentId: MIA, kind: "time", durationMs: 600_000 }); // capped to 60 s
    const week = await getWeeklyActivity(db, userA, new Date(), "Asia/Shanghai");
    expect(week.byStrand.meaning_focused_input).toBe(1.8);
    expect(week.activeDaysThisWeek).toBe(1);
    expect((await getWeeklyActivity(db, userB, new Date(), "Asia/Shanghai")).totalMinutes).toBe(0);
  });
});
