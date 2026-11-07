// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/config/env";

import { aiStatus } from "./provider";
import { AIError, codeForStatus } from "./provider/errors";
import { MockProvider } from "./provider/mock";
import { OpenAIProvider } from "./provider/openai";
import { estimateCost, startOfLocalMonth } from "./services/usage";
import { buildSystemPrompt, type TutorContext } from "./tutor/prompts";
import { parseTutorReply } from "./tutor/schema";

const base = { APP_SECRET: "x".repeat(40), DATABASE_URL: "postgres://u:p@localhost:5432/db" };

const ctx = (over: Partial<TutorContext> = {}): TutorContext => ({
  level: "A1",
  levelBasis: "阅读估计",
  explanationLanguage: "zh",
  goals: ["travel"],
  recentWords: ["hello", "breakfast"],
  recentLessons: [],
  weakSpots: ["冠词 a / an / the（冠词）"],
  material: null,
  ...over,
});

describe("AI status", () => {
  it("explains why AI is unavailable and never exposes the key", () => {
    expect(aiStatus(parseEnv(base))).toEqual({ available: false, reason: "disabled", provider: "openai" });
    expect(aiStatus(parseEnv({ ...base, AI_ENABLED: "true" }))).toMatchObject({ available: false, reason: "missing_key" });
    expect(aiStatus(parseEnv({ ...base, AI_ENABLED: "true", AI_API_KEY: "sk-secret" }))).toMatchObject({ available: false, reason: "missing_model" });
    const ok = aiStatus(parseEnv({ ...base, AI_ENABLED: "true", AI_API_KEY: "sk-secret", AI_TEXT_MODEL: "small-model" }));
    expect(ok).toEqual({ available: true, provider: "openai", textModel: "small-model", simulated: false });
    expect(JSON.stringify(ok)).not.toContain("sk-secret");
    expect(aiStatus(parseEnv({ ...base, AI_ENABLED: "true", AI_PROVIDER: "mock" }))).toMatchObject({ available: true, simulated: true });
    expect(() => parseEnv({ ...base, AI_BASE_URL: "ftp://x" })).toThrow();
  });
});

describe("tutor prompts", () => {
  it("carries the level policy, the mode and only the context the mode needs", () => {
    const explain = buildSystemPrompt("explain", ctx());
    expect(explain).toMatch(/^LEVEL: A1$/m);
    expect(explain).toMatch(/^MODE: explain$/m);
    expect(explain).toContain("Explain difficult points in Chinese");
    expect(explain).toContain("Reply with ONE JSON object");
    expect(explain).not.toContain("breakfast"); // recent words only for review / practice / ask_me
    const review = buildSystemPrompt("review", ctx({ level: "B2" }));
    expect(review).toContain("Recently learned words: hello, breakfast.");
    expect(review).toContain("冠词");
    expect(review).toContain("Do not add Chinese unless the learner asks");
    const chat = buildSystemPrompt("roleplay", ctx(), "hotel");
    expect(chat).toContain("hotel receptionist");
    expect(chat).not.toContain("JSON");
    const coach = buildSystemPrompt("reading_coach", ctx({ material: { title: "This Is Mia", sentences: [{ n: 1, en: "Hello! My name is Mia." }], focus: 1 } }));
    expect(coach).toContain("[1] Hello! My name is Mia.");
    expect(coach).toContain("sentence [1]");
  });
});

describe("tutor reply validation", () => {
  const valid = { response_text: "Good!", level_adaptation: "A1", correction: null, new_vocabulary: [], follow_up_question: null, suggested_practice: [] };

  it("accepts JSON with code fences or text around it", () => {
    expect(parseTutorReply("```json\n" + JSON.stringify(valid) + "\n```").response_text).toBe("Good!");
    expect(parseTutorReply("Sure! " + JSON.stringify(valid) + " Hope it helps").response_text).toBe("Good!");
  });

  it("cleans up fields and drops unsafe links", () => {
    const r = parseTutorReply(
      JSON.stringify({
        response_text: "Try again",
        correction: { original: "same", corrected: "same" },
        new_vocabulary: Array.from({ length: 9 }, (_, i) => ({ text: `w${i}`, zh: "词" })),
        suggested_practice: ["Do the grammar drill", { title: "Phishing", href: "https://evil.example" }, { title: "Grammar", href: "/grammar" }],
      }),
    );
    expect(r.correction).toBeNull(); // no change is not a correction
    expect(r.new_vocabulary).toHaveLength(6);
    expect(r.suggested_practice).toEqual([
      { title: "Do the grammar drill", href: null },
      { title: "Phishing", href: null },
      { title: "Grammar", href: "/grammar" },
    ]);
  });

  it("rejects replies that don't match the schema", () => {
    expect(() => parseTutorReply("{ not json")).toThrow(AIError);
    expect(() => parseTutorReply(JSON.stringify({ level_adaptation: "A1" }))).toThrow(AIError);
  });
});

describe("mock provider", () => {
  const mock = new MockProvider();
  const input = (content: string, json = true) => ({ task: "tutor_structured" as const, system: "LEVEL: A1\nMODE: correct", messages: [{ role: "user" as const, content }], json, maxOutputTokens: 500 });

  it("returns valid structured replies with a correction for common mistakes", async () => {
    const r = parseTutorReply((await mock.generateText(input("I very busy today."))).text);
    expect(r.correction).toMatchObject({ original: "I very busy today.", corrected: "I am very busy today." });
    expect(r.response_text).toContain("模拟");
    expect(parseTutorReply((await mock.generateText(input("She go to school."))).text).correction!.corrected).toBe("She goes to school.");
    expect(parseTutorReply((await mock.generateText(input("I like tea."))).text).correction).toBeNull();
  });

  it("can simulate failures and streams text", async () => {
    await expect(mock.generateText(input("[mock:error:timeout] hi"))).rejects.toMatchObject({ code: "timeout" });
    const parts: string[] = [];
    for await (const p of mock.streamText(input("hi"))) if (p.type === "delta") parts.push(p.text);
    expect(parts.join("")).toContain("模拟回复");
  });
});

describe("OpenAI provider (no network)", () => {
  function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it("sends the right request and reads text and usage", async () => {
    const { impl, calls } = fakeFetch(() => Response.json({ model: "m-1", choices: [{ message: { content: '{"response_text":"hi"}' } }], usage: { prompt_tokens: 12, completion_tokens: 5 } }));
    const p = new OpenAIProvider({ apiKey: "sk-secret", baseUrl: "https://example.test/v1/", textModel: "m-1", timeoutMs: 5000, fetchImpl: impl });
    const r = await p.generateText({ task: "tutor_structured", system: "sys", messages: [{ role: "user", content: "hello" }], json: true, maxOutputTokens: 300 });
    expect(r).toEqual({ text: '{"response_text":"hi"}', usage: { inputTokens: 12, outputTokens: 5 }, model: "m-1" });
    expect(calls[0]!.url).toBe("https://example.test/v1/chat/completions");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({ model: "m-1", max_completion_tokens: 300, response_format: { type: "json_object" } });
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-secret");
  });

  it("maps HTTP errors without leaking the key", async () => {
    for (const [status, code] of [[401, "auth"], [429, "rate_limited"], [503, "provider_unavailable"]] as const) {
      const { impl } = fakeFetch(() => new Response("nope sk-secret", { status }));
      const p = new OpenAIProvider({ apiKey: "sk-secret", baseUrl: "https://example.test/v1", textModel: "m", timeoutMs: 5000, fetchImpl: impl });
      const err = await p.generateText({ task: "tutor_chat", system: "s", messages: [], json: false, maxOutputTokens: 10 }).catch((e: unknown) => e as AIError);
      expect(err).toBeInstanceOf(AIError);
      expect((err as AIError).code).toBe(code);
      expect((err as AIError).message).not.toContain("sk-secret");
    }
    expect(codeForStatus(400)).toBe("unknown");
  });

  it("parses a server-sent event stream", async () => {
    const sse = [
      'data: {"model":"m-2","choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo!"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}',
      "data: [DONE]",
      "",
    ].join("\n");
    const { impl } = fakeFetch(() => new Response(sse, { headers: { "Content-Type": "text/event-stream" } }));
    const p = new OpenAIProvider({ apiKey: "k", baseUrl: "https://example.test/v1", textModel: "m", timeoutMs: 5000, fetchImpl: impl });
    const out: unknown[] = [];
    for await (const part of p.streamText({ task: "tutor_chat", system: "s", messages: [], maxOutputTokens: 10 })) out.push(part);
    expect(out).toEqual([
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo!" },
      { type: "done", usage: { inputTokens: 3, outputTokens: 2 }, model: "m-2" },
    ]);
  });
});

describe("cost", () => {
  it("estimates cost only when prices are configured", () => {
    expect(estimateCost({ inputTokens: 1000, outputTokens: 500 }, parseEnv(base))).toBeNull();
    expect(estimateCost({ inputTokens: 1_000_000, outputTokens: 500_000 }, parseEnv({ ...base, AI_TEXT_PRICE_INPUT_PER_1M: "0.5", AI_TEXT_PRICE_OUTPUT_PER_1M: "2" }))).toBe(1.5);
  });

  it("finds the start of the learner's local month", () => {
    expect(startOfLocalMonth(new Date("2026-11-07T10:00:00Z"), "Asia/Shanghai").toISOString()).toBe("2026-10-31T16:00:00.000Z");
    expect(startOfLocalMonth(new Date("2026-10-31T17:00:00Z"), "Asia/Shanghai").toISOString()).toBe("2026-10-31T16:00:00.000Z");
  });
});
