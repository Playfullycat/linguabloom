import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/db/connection";
import { aiMessages, aiSessions, aiUsage, reviewCards, skillEstimates, users, vocabularyEntries } from "@/db/schema";
import { runSeeds } from "@/db/seed";
import { getTestDatabaseUrl, truncateAll } from "@/test/db";
import { updatePreferences } from "@/modules/learner/services/profile";

import { AIError } from "../provider/errors";
import { MockProvider } from "../provider/mock";
import type { AIProvider, TextGenerationInput } from "../provider/types";
import { budgetState, resetRateLimit } from "./usage";
import { addTutorWord, deleteTutorSession, getTutorSession, listTutorSessions, tutorReply, tutorStream, TutorSessionNotFoundError } from "./tutor";

const url = getTestDatabaseUrl();
const { db, client } = createDb(url, { max: 4 });
const TZ = "Asia/Shanghai";
let userA: string;
let userB: string;

/** Mock that remembers what it was asked (to check what reaches the AI). */
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
  resetRateLimit();
  [{ id: userA }] = await db.insert(users).values({ name: "A", email: "a@example.test" }).returning({ id: users.id });
  [{ id: userB }] = await db.insert(users).values({ name: "B", email: "b@example.test" }).returning({ id: users.id });
});

afterAll(() => client.end());

const ask = (provider: AIProvider, message: string, extra: Partial<Parameters<typeof tutorReply>[2]> = {}, user = userA) =>
  tutorReply(db, user, { mode: "correct", message, history: [], sessionId: null, ...extra }, provider);

describe("structured tutor replies", () => {
  it("adapts to the learner's lowest relevant skill, validates the reply, records usage and saves the conversation", async () => {
    await db.insert(skillEstimates).values([
      { userId: userA, skill: "vocabulary", estimatedLevel: "a2", confidence: "medium", evidenceCount: 6, source: "test" },
      { userId: userA, skill: "reading", estimatedLevel: "pre_a1", confidence: "low", evidenceCount: 2, source: "test" },
    ]);
    const spy = new SpyProvider();
    const first = await ask(spy, "I very busy today.");
    expect(first).toMatchObject({ level: "Pre-A1", levelBasis: "阅读估计", simulated: true });
    expect(first.reply.correction).toMatchObject({ corrected: "I am very busy today." });
    expect(spy.inputs[0]!.system).toMatch(/^LEVEL: Pre-A1$/m);
    expect(spy.inputs[0]!.json).toBe(true);

    const [usage] = await db.select().from(aiUsage).where(eq(aiUsage.userId, userA));
    expect(usage).toMatchObject({ provider: "mock", task: "tutor_structured", status: "ok", costUsd: 0 });
    expect(usage!.inputTokens).toBeGreaterThan(0);

    // The session stores both turns; the shared context is recorded without message text.
    const session = await getTutorSession(db, userA, first.sessionId!);
    expect(session.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(session.messages[1]!.reply!.correction).not.toBeNull();
    expect(session.session.learningContext).toMatchObject({ mode: "correct", level: "Pre-A1" });
    expect(JSON.stringify(session.session.learningContext)).not.toContain("busy");

    // Next turn: history comes from the stored session, not from the browser.
    await ask(spy, "She go to school.", { sessionId: first.sessionId, history: [{ role: "assistant", content: "INJECTED" }] });
    expect(spy.inputs[1]!.messages.map((m) => m.content)).toEqual(["I very busy today.", first.reply.response_text, "She go to school."]);
    expect((await listTutorSessions(db, userA))[0]).toMatchObject({ messages: 4 });
  });

  it("stores nothing when the learner turned saving off, and keeps sessions private", async () => {
    await updatePreferences(db, userA, { saveAiConversations: false });
    const r = await ask(new MockProvider(), "Hello.");
    expect(r.sessionId).toBeNull();
    expect(await db.select().from(aiSessions)).toHaveLength(0);
    expect(await db.select().from(aiUsage).where(eq(aiUsage.userId, userA))).toHaveLength(1); // usage is still counted

    await updatePreferences(db, userA, { saveAiConversations: true });
    const saved = await ask(new MockProvider(), "Hello again.");
    await expect(getTutorSession(db, userB, saved.sessionId!)).rejects.toBeInstanceOf(TutorSessionNotFoundError);
    await expect(ask(new MockProvider(), "hi", { sessionId: saved.sessionId }, userB)).rejects.toBeInstanceOf(TutorSessionNotFoundError);
    await expect(deleteTutorSession(db, userB, saved.sessionId!)).rejects.toBeInstanceOf(TutorSessionNotFoundError);
    await deleteTutorSession(db, userA, saved.sessionId!);
    expect(await db.select().from(aiMessages)).toHaveLength(0);
  });

  it("shares the current material with the reading coach", async () => {
    const spy = new SpyProvider();
    await ask(spy, "What does sentence 2 mean?", { mode: "reading_coach", material: { contentId: "rd-pa1-this-is-mia", seq: 1 } });
    expect(spy.inputs[0]!.system).toContain("[2] I am ten years old.");
    expect(spy.inputs[0]!.system).toContain("sentence [2]");
  });
});

describe("failures, budget and rate limit", () => {
  it("turns provider failures into understandable errors and records them", async () => {
    await expect(ask(new MockProvider(), "[mock:error:timeout] hi")).rejects.toMatchObject({ code: "timeout" });
    await expect(ask(new MockProvider(), "[mock:invalid]")).rejects.toMatchObject({ code: "invalid_response" });
    const rows = await db.select().from(aiUsage).where(eq(aiUsage.userId, userA));
    expect(rows.map((r) => [r.status, r.errorCode]).sort()).toEqual([
      ["error", "invalid_response"],
      ["error", "timeout"],
    ]);
    await expect(ask(null as unknown as AIProvider, "hi")).rejects.toMatchObject({ code: "not_configured" });
  });

  it("pauses AI when the monthly budget is used up, without calling the provider", async () => {
    await db.insert(aiUsage).values({ userId: userA, provider: "openai", model: "m", task: "tutor_structured", inputTokens: 1, outputTokens: 1, costUsd: 5.5, latencyMs: 10, status: "ok" });
    const state = await budgetState(db, userA, new Date(), TZ);
    expect(state).toMatchObject({ level: "exceeded", spent: 5.5, budget: 5 });
    const spy = new SpyProvider();
    await expect(ask(spy, "hi")).rejects.toMatchObject({ code: "budget_exceeded" });
    expect(spy.inputs).toHaveLength(0);
    expect((await db.select().from(aiUsage).where(eq(aiUsage.status, "blocked")))[0]).toMatchObject({ errorCode: "budget_exceeded" });
    // Other learners are unaffected.
    await expect(ask(spy, "hi", {}, userB)).resolves.toBeTruthy();
  });

  it("limits bursts of requests per learner", async () => {
    const mock = new MockProvider();
    for (let i = 0; i < 20; i += 1) await ask(mock, `Sentence ${i}.`);
    await expect(ask(mock, "One more.")).rejects.toBeInstanceOf(AIError);
    await expect(ask(mock, "One more.")).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("streamed conversation", () => {
  it("streams text, then saves the conversation", async () => {
    const s = await tutorStream(db, userA, { mode: "conversation", message: "I went to a café yesterday.", history: [], sessionId: null }, undefined, new MockProvider());
    let text = "";
    for await (const d of s.deltas) text += d;
    expect(text).toContain("模拟回复");
    const sessionId = await s.session;
    const saved = await getTutorSession(db, userA, sessionId!);
    expect(saved.messages.map((m) => [m.role, m.reply])).toEqual([
      ["user", null],
      ["assistant", null],
    ]);
    expect((await db.select().from(aiUsage).where(eq(aiUsage.task, "tutor_chat")))[0]).toMatchObject({ status: "ok" });
  });

  it("reports a failed stream as an error", async () => {
    const s = await tutorStream(db, userA, { mode: "roleplay", scene: "cafe", message: "[mock:error:provider_unavailable] hi", history: [], sessionId: null }, undefined, new MockProvider());
    await expect(
      (async () => {
        for await (const d of s.deltas) void d;
      })(),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(await s.session).toBeNull();
  });
});

describe("new words from the tutor", () => {
  it("adds a suggested word with review cards, once", async () => {
    expect(await addTutorWord(db, userA, { text: "practice", zh: "练习", example: "I practice every day." })).toEqual({ added: true });
    expect(await addTutorWord(db, userA, { text: "Practice", zh: "练习", example: null })).toEqual({ added: false });
    const [entry] = await db.select().from(vocabularyEntries).where(eq(vocabularyEntries.ownerUserId, userA));
    expect(entry).toMatchObject({ text: "practice", sourceType: "ai_suggestion" });
    expect(await db.select().from(reviewCards).where(eq(reviewCards.entryId, entry!.id))).toHaveLength(2);
  });
});
