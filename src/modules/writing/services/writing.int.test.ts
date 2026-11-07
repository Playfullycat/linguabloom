import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/db/connection";
import { aiDefinitions, aiUsage, exercises, learningContents, reviewCards, skillEstimates, users, vocabularyEntries, writingSubmissions } from "@/db/schema";
import { runSeeds } from "@/db/seed";
import { getTestDatabaseUrl, truncateAll } from "@/test/db";
import { MockProvider } from "@/modules/ai/provider/mock";
import type { TextGenerationInput } from "@/modules/ai/provider/types";
import {
  GenerationNotFoundError,
  collectAiWord,
  discardGeneration,
  explainWord,
  generateEnrichment,
  generateGradedReading,
  generateMicroLesson,
  getGeneration,
  latestMicroLesson,
  publishGeneration,
} from "@/modules/ai/services/generation";
import { resetRateLimit } from "@/modules/ai/services/usage";
import { listErrors } from "@/modules/errors/services/errors";
import { answerExercise } from "@/modules/grammar/services/grammar";
import { createDraft, publishImport } from "@/modules/imports/services/imports";
import { getMaterialForReader } from "@/modules/materials/services/materials";

import { WritingNotFoundError, WritingRejectedError, deleteWriting, getWriting, listWritings, requestFeedback, reviseWriting, submitWriting } from "./writing";

const url = getTestDatabaseUrl();
const { db, client } = createDb(url, { max: 4 });
const mock = new MockProvider();
let userA: string;
let userB: string;

class SpyProvider extends MockProvider {
  inputs: TextGenerationInput[] = [];
  override async generateText(input: TextGenerationInput) {
    this.inputs.push(input);
    return super.generateText(input);
  }
}

beforeAll(async () => {
  await truncateAll(url);
  await runSeeds(url, () => {});
});

beforeEach(async () => {
  await db.delete(users);
  await db.delete(aiDefinitions);
  resetRateLimit();
  [{ id: userA }] = await db.insert(users).values({ name: "A", email: "a@example.test" }).returning({ id: users.id });
  [{ id: userB }] = await db.insert(users).values({ name: "B", email: "b@example.test" }).returning({ id: users.id });
});

afterAll(() => client.end());

const TEXT = "My name is Lin. I very busy every day. She go to work by bus. I like music and I have a apple every morning. I live in Hangzhou with my family.";

describe("writing studio", () => {
  it("gives layered, validated feedback, records sure grammar errors, and keeps the text", async () => {
    const spy = new SpyProvider();
    const id = await submitWriting(db, userA, { promptId: "w-a1-about-me", text: TEXT }, spy);
    expect(spy.inputs[0]!.system).toMatch(/^LEVEL: A1$/m);
    expect(spy.inputs[0]!.system).toContain("be-verb (be 动词 am / is / are)"); // allowed grammar points listed
    const w = await getWriting(db, userA, id);
    expect(w).toMatchObject({ status: "feedback", confidence: "medium", taskType: "diary", level: "A1", originalText: TEXT });
    expect(w.feedback!.task_completion.rating).toBe("met");
    expect(w.feedback!.grammar.map((g) => g.corrected)).toEqual(["I am very busy every day.", "She goes to work by bus.", "I like music and I have an apple every morning."]);
    expect(w.feedback!.limitations[0]).toContain("模拟");

    const errors = await listErrors(db, userA);
    expect(errors.map((e) => [e.pointType, e.pointId, e.occurrenceCount]).sort()).toEqual([
      ["grammar", "articles", 1],
      ["grammar", "be-verb", 1],
      ["grammar", "present-simple", 1],
    ]);
    expect((await db.select().from(aiUsage).where(eq(aiUsage.task, "writing_feedback")))[0]).toMatchObject({ status: "ok" });
    expect(await listWritings(db, userB)).toEqual([]);
    await expect(getWriting(db, userB, id)).rejects.toBeInstanceOf(WritingNotFoundError);
  });

  it("compares the second version with the first", async () => {
    const id = await submitWriting(db, userA, { promptId: "w-a1-about-me", text: TEXT }, mock);
    const revised = "My name is Lin. I am very busy every day. She goes to work by bus. I like music and I have an apple every morning. I live in Hangzhou with my family.";
    const fb = await reviseWriting(db, userA, id, revised, mock);
    expect(fb.grammar).toEqual([]);
    expect(fb.comparison!.improved.length).toBeGreaterThan(0);
    expect(await getWriting(db, userA, id)).toMatchObject({ status: "revised", revisedText: revised });
    // Revisions don't add notebook entries again.
    expect((await listErrors(db, userA)).every((e) => e.occurrenceCount === 1)).toBe(true);
  });

  it("drops problems that quote words the learner never wrote", async () => {
    class Inventing extends MockProvider {
      override async generateText(input: TextGenerationInput) {
        const r = await super.generateText(input);
        const data = JSON.parse(r.text);
        data.grammar.push({ original: "I has three cats.", corrected: "I have three cats.", explanation_zh: "x", category: "agreement", grammar_point: "not-a-point", severity: "high" });
        return { ...r, text: JSON.stringify(data) };
      }
    }
    const id = await submitWriting(db, userA, { promptId: null, custom: { title: "Me", task: "Write about you" }, text: TEXT }, new Inventing());
    const w = await getWriting(db, userA, id);
    expect(w.feedback!.grammar.some((g) => g.original.includes("three cats"))).toBe(false);
    expect(w).toMatchObject({ taskType: "free", promptId: null });
  });

  it("keeps the draft when the AI fails, and lets the learner retry", async () => {
    await expect(submitWriting(db, userA, { promptId: "w-a1-about-me", text: "[mock:error:timeout] " + TEXT }, mock)).rejects.toMatchObject({ code: "timeout" });
    const [row] = await db.select().from(writingSubmissions).where(eq(writingSubmissions.userId, userA));
    expect(row).toMatchObject({ status: "draft", feedback: null });
    await db.update(writingSubmissions).set({ originalText: TEXT }).where(eq(writingSubmissions.id, row!.id));
    await requestFeedback(db, userA, row!.id, mock);
    expect((await getWriting(db, userA, row!.id)).status).toBe("feedback");
    await expect(submitWriting(db, userA, { promptId: "w-a1-about-me", text: "Hi." }, mock)).rejects.toBeInstanceOf(WritingRejectedError);
    await deleteWriting(db, userA, row!.id);
    expect(await listWritings(db, userA)).toHaveLength(0);
  });

  it("estimates a writing level only after three confident texts, always with low confidence", async () => {
    for (let i = 0; i < 2; i += 1) await submitWriting(db, userA, { promptId: "w-a1-about-me", text: TEXT }, mock);
    expect(await db.select().from(skillEstimates).where(eq(skillEstimates.skill, "writing"))).toHaveLength(0);
    await submitWriting(db, userA, { promptId: "w-a1-about-me", text: TEXT }, mock);
    const [est] = await db.select().from(skillEstimates).where(eq(skillEstimates.skill, "writing"));
    expect(est).toMatchObject({ estimatedLevel: "a1", confidence: "low", evidenceCount: 3, source: "ai_writing" });
  });
});

describe("AI word explanations", () => {
  it("explains a word in context once, then serves it from the cache, and can keep it", async () => {
    const spy = new SpyProvider();
    const first = await explainWord(db, userA, { word: "Mia", sentence: "Hello! My name is Mia." }, spy);
    expect(first).toMatchObject({ text: "Mia", cached: false, ipa: null });
    const again = await explainWord(db, userA, { word: "mia", sentence: "Hello! My name is Mia." }, spy);
    expect(again.cached).toBe(true);
    expect(spy.inputs).toHaveLength(1);
    expect(await collectAiWord(db, userA, first)).toEqual({ added: true });
    expect(await collectAiWord(db, userA, first)).toEqual({ added: false });
    const [entry] = await db.select().from(vocabularyEntries).where(eq(vocabularyEntries.ownerUserId, userA));
    expect(entry).toMatchObject({ sourceType: "ai_definition", text: "Mia" });
    expect(await db.select().from(reviewCards).where(eq(reviewCards.entryId, entry!.id))).toHaveLength(2);
  });
});

describe("generated content is a draft until confirmed", () => {
  it("adds a checked glossary and questions to an imported material", async () => {
    const imp = await createDraft(db, userA, { purpose: "reading", sourceKind: "paste", title: "Market", fileName: null, text: "Every Saturday we visit the farmers market. The vegetables are fresh and cheap. My grandmother chooses tomatoes carefully.", copyrightStatus: "own_work", sourceNote: null, audio: null });
    const { contentId } = await publishImport(db, userA, imp, { level: "a2" });
    const genId = await generateEnrichment(db, userA, contentId!, mock);
    const g = await getGeneration(db, userA, genId);
    expect(g).toMatchObject({ status: "draft", kind: "material_enrichment" });
    expect(g.warnings).toContain("生词“notinthetextatall”不在原文里，已去掉。");
    // Not applied before confirmation.
    expect((await getMaterialForReader(db, userA, contentId!)).glossary).toEqual([]);
    await publishGeneration(db, userA, genId);
    const m = await getMaterialForReader(db, userA, contentId!);
    expect(m.glossary.length).toBeGreaterThan(0);
    // Every glossary word really comes from the text (the invented one was dropped).
    expect(m.glossary.every((x) => /Saturday|farmers|market|vegetables|grandmother|chooses|tomatoes|carefully/i.test(x.text))).toBe(true);
    expect(m.questions).toHaveLength(2);
    await expect(generateEnrichment(db, userB, contentId!, mock)).rejects.toThrow();
  });

  it("generates a graded reading that passes the same checks as built-in material", async () => {
    const genId = await generateGradedReading(db, userA, { topic: "cooking", level: "a1", type: "listening" }, mock);
    const g = await getGeneration(db, userA, genId);
    expect(g.payload).toMatchObject({ type: "listening", level: "a1" });
    const before = await db.select().from(learningContents).where(eq(learningContents.ownerUserId, userA));
    expect(before).toHaveLength(0);
    const res = await publishGeneration(db, userA, genId);
    const m = await getMaterialForReader(db, userA, (res as { contentId: string }).contentId);
    expect(m).toMatchObject({ type: "listening", imported: true, sourceType: "ai_generated", copyrightStatus: "ai_generated" });
    expect(m.summaryZh).toContain("AI 生成的虚构内容");
    expect(m.segments.every((s) => s.speaker)).toBe(true);
    expect(m.questions).toHaveLength(2);
    await expect(publishGeneration(db, userA, genId)).rejects.toThrow();
    await expect(getGeneration(db, userB, genId)).rejects.toBeInstanceOf(GenerationNotFoundError);
    const second = await generateGradedReading(db, userA, { topic: "football", level: "a1", type: "reading" }, mock);
    await discardGeneration(db, userA, second);
    expect((await getGeneration(db, userA, second)).status).toBe("discarded");
  });

  it("builds a micro-lesson for a recurring error, with only valid exercises, practised privately", async () => {
    await answerExercise(db, userA, { exerciseId: "be-verb.e1", response: { choice: 0 }, clientRequestId: crypto.randomUUID(), context: "practice" });
    const [item] = await listErrors(db, userA);
    const genId = await generateMicroLesson(db, userA, item!.id, mock);
    const g = await getGeneration(db, userA, genId);
    expect(g.warnings).toEqual(["第 4 道题格式不对，已去掉。"]);
    expect((g.payload as { exercises: unknown[] }).exercises).toHaveLength(3);
    const res = (await publishGeneration(db, userA, genId)) as { exerciseIds: string[] };
    expect(res.exerciseIds).toHaveLength(3);
    expect((await latestMicroLesson(db, userA, item!.id))!.status).toBe("published");
    const [ex] = await db.select().from(exercises).where(eq(exercises.id, res.exerciseIds[0]!));
    expect(ex).toMatchObject({ ownerUserId: userA, grammarPointId: null, errorCategory: item!.category });
    // Only the owner can answer them.
    await expect(answerExercise(db, userB, { exerciseId: res.exerciseIds[0]!, response: { choice: 0 }, clientRequestId: crypto.randomUUID(), context: "practice" })).rejects.toThrow();
    expect((await answerExercise(db, userA, { exerciseId: res.exerciseIds[0]!, response: { choice: 0 }, clientRequestId: crypto.randomUUID(), context: "practice" })).isCorrect).toBe(true);
  });
});
