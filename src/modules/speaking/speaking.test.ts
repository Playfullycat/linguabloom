// @vitest-environment node
import { describe, expect, it } from "vitest";

import { MockProvider, silentWav } from "@/modules/ai/provider/mock";

import a1 from "../../content/materials/a1.json" with { type: "json" };
import a2 from "../../content/materials/a2.json" with { type: "json" };
import preA1 from "../../content/materials/pre-a1.json" with { type: "json" };
import { SPEAKING_TYPES, isScripted, loadSpeakingTasks, speakingTaskSchema } from "./content";
import { compareReading } from "./domain/compare";
import { FIXED_LIMITATIONS, PRONUNCIATION_NOTE, parseSpeakingFeedback } from "./domain/feedback";
import { feedbackSystemPrompt, transcriptForFeedback, voiceTeacherInstructions } from "./domain/prompts";
import { finalTurns, initialVoiceState, voiceReducer, type VoiceEvent, type VoiceState } from "./domain/voice-session";

describe("speaking tasks", () => {
  const tasks = loadSpeakingTasks();
  it("cover all seven task types with valid content", () => {
    expect(new Set(tasks.map((t) => t.type))).toEqual(new Set(SPEAKING_TYPES));
    for (const t of tasks) {
      if (isScripted(t.type)) expect(t.items?.length).toBeGreaterThan(0);
      else expect(t.opening_en).toBeTruthy();
    }
  });

  it("retelling tasks point at real built-in materials", () => {
    const ids = new Set([...preA1.materials, ...a1.materials, ...a2.materials].map((m) => m.id));
    for (const t of tasks.filter((x) => x.type === "retelling")) expect(ids.has(t.source_material!)).toBe(true);
  });

  it("rejects a conversation task without an opening line", () => {
    const r = speakingTaskSchema.safeParse({ id: "sp-x", type: "opinion", level: "a1", title_zh: "x", title_en: "x", goal_zh: "x", instructions_zh: "x", can_do_zh: "x" });
    expect(r.success).toBe(false);
  });
});

describe("compareReading", () => {
  it("ignores case and punctuation and marks missed words", () => {
    const c = compareReading("Hello! My name is Anna.", "hello my name anna");
    expect(c.total).toBe(5);
    expect(c.heard).toBe(4);
    expect(c.score).toBe(0.8);
    expect(c.words.find((w) => !w.heard)?.text).toBe("is");
  });

  it("keeps order (LCS) and lists extra words", () => {
    const c = compareReading("I go to work by bus.", "I go to to the work by car");
    expect(c.heard).toBe(5);
    expect(c.words.map((w) => w.heard)).toEqual([true, true, true, true, true, false]);
    expect(c.extra).toEqual(["to", "the", "car"]);
  });

  it("handles apostrophes and an empty transcript", () => {
    expect(compareReading("I'm fine, thank you.", "I’m fine thank you").score).toBe(1);
    expect(compareReading("Nice to meet you.", "").heard).toBe(0);
  });
});

const feedbackJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    task_completion: { rating: "met", comment_zh: "完成" },
    comprehensibility: { rating: "clear", comment_zh: "清楚" },
    fluency: { comment_zh: "还可以" },
    grammar: [
      { original: "She like reading", corrected: "She likes reading", explanation_zh: "三单", category: "agreement", severity: "medium" },
      { original: "I goed home", corrected: "I went home", explanation_zh: "编造的", category: "tense", severity: "high" },
    ],
    vocabulary: { comment_zh: "ok", suggestions: [{ original: "nice", suggestion: "lovely", explanation_zh: "" }] },
    pronunciation: { score: 90 },
    self_correction: null,
    strengths: ["敢说"],
    can_do_evidence: [],
    priorities: ["三单"],
    confidence: "high",
    limitations: ["自定义限制"],
    next_action: "再练一次",
    ...over,
  });

describe("parseSpeakingFeedback", () => {
  const said = "She like reading books. It is nice and relaxing. I read every evening before bed with my cat.";

  it("drops problems the learner never said, caps confidence, never scores pronunciation", () => {
    const { feedback, dropped } = parseSpeakingFeedback(feedbackJson(), said, 25);
    expect(feedback.grammar.map((g) => g.original)).toEqual(["She like reading"]);
    expect(dropped).toBe(1);
    expect(feedback.confidence).toBe("medium");
    expect(feedback.pronunciation_note_zh).toBe(PRONUNCIATION_NOTE);
    expect(JSON.stringify(feedback)).not.toContain('"score"');
    expect(feedback.limitations.slice(0, 2)).toEqual(FIXED_LIMITATIONS);
    expect(feedback.limitations).toContain("自定义限制");
  });

  it("little speech means low confidence", () => {
    const { feedback } = parseSpeakingFeedback(feedbackJson(), said, 8);
    expect(feedback.confidence).toBe("low");
    expect(feedback.limitations.join()).toContain("比较少");
  });

  it("rejects malformed output", () => {
    expect(() => parseSpeakingFeedback("{ nope", said, 30)).toThrow();
    expect(() => parseSpeakingFeedback(JSON.stringify({ confidence: "high" }), said, 30)).toThrow();
  });

  it("accepts the mock provider's feedback", async () => {
    const mock = new MockProvider();
    const r = await mock.generateText({ task: "speaking_feedback", system: "LEVEL: A1", messages: [{ role: "user", content: "TRANSCRIPT:\nTEACHER: Hi\nLEARNER: She like reading books in the evening." }], json: true, maxOutputTokens: 500 });
    const { feedback } = parseSpeakingFeedback(r.text, "She like reading books in the evening.", 7);
    expect(feedback.grammar).toHaveLength(1);
    expect(feedback.confidence).toBe("low");
  });
});

describe("prompts", () => {
  const task = loadSpeakingTasks().find((t) => t.id === "sp-roleplay-cafe")!;
  it("adapt to the level and follow the beginner teacher rules", () => {
    const a1 = voiceTeacherInstructions(task, { level: "A1", explanationLanguage: "zh" }, { realtime: true });
    expect(a1).toContain("LEVEL: A1");
    expect(a1).toContain("very short sentences");
    expect(a1).toContain("ONE question");
    expect(a1).toContain(task.opening_en!);
    expect(a1).toContain("An accent is not a mistake");
    const b1 = voiceTeacherInstructions(task, { level: "B1", explanationLanguage: "en" }, { realtime: false, finalTurn: true });
    expect(b1).not.toContain("very short sentences");
    expect(b1).toContain("LAST turn");
    expect(b1).not.toContain("Start the conversation");
  });

  it("feedback prompt forbids pronunciation scoring and exam claims", () => {
    const p = feedbackSystemPrompt(task, { level: "A1", explanationLanguage: "zh" });
    expect(p).toContain("Do NOT assess pronunciation");
    expect(p).toContain("never give or imply an official exam score");
  });

  it("scripted transcripts show the reference line", () => {
    const read = loadSpeakingTasks().find((t) => t.type === "read_aloud")!;
    const text = transcriptForFeedback(read, [{ role: "learner", text: "Hello my name Anna", item: 0 }], { durationSeconds: 30 });
    expect(text).toContain(`REFERENCE 1: ${read.items![0]}`);
    expect(text).toContain("LEARNER: Hello my name Anna");
  });
});

describe("realtime session reducer", () => {
  const run = (events: VoiceEvent[], from: VoiceState = initialVoiceState) => events.reduce((s, e, i) => voiceReducer(s, e, 1000 + i * 100), from);

  it("walks connecting → thinking → speaking → listening with transcripts", () => {
    const s = run([
      { type: "local.connecting" },
      { type: "local.connected" },
      { type: "response.created" },
      { type: "response.output_audio_transcript.delta", item_id: "a1", delta: "Hi! " },
      { type: "response.output_audio_transcript.delta", item_id: "a1", delta: "What's your name?" },
    ]);
    expect(s.phase).toBe("speaking");
    const after = run([{ type: "response.output_audio_transcript.done", item_id: "a1", transcript: "Hi! What's your name?" }, { type: "response.done", response: { status: "completed" } }, { type: "output_audio_buffer.stopped" }], s);
    expect(after.phase).toBe("listening");
    const learner = run(
      [
        { type: "input_audio_buffer.speech_started", item_id: "u1" },
        { type: "input_audio_buffer.speech_stopped", item_id: "u1" },
        { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: " My name is Lin. " },
      ],
      after,
    );
    expect(learner.phase).toBe("thinking");
    expect(learner.learnerSpeechMs).toBe(100);
    expect(finalTurns(learner)).toEqual([
      { role: "ai", text: "Hi! What's your name?", interrupted: false },
      { role: "learner", text: "My name is Lin.", interrupted: false },
    ]);
  });

  it("supports the older beta event names", () => {
    const s = run([{ type: "local.connecting" }, { type: "local.connected" }, { type: "response.audio_transcript.delta", item_id: "a", delta: "Hello" }, { type: "response.audio_transcript.done", item_id: "a", transcript: "Hello there" }]);
    expect(finalTurns(s)[0]?.text).toBe("Hello there");
  });

  it("the learner can interrupt the teacher (button or by speaking)", () => {
    const speaking = run([{ type: "local.connecting" }, { type: "local.connected" }, { type: "response.output_audio_transcript.delta", item_id: "a", delta: "Let me tell you a long story" }]);
    const byButton = voiceReducer(speaking, { type: "local.interrupt" });
    expect(byButton.phase).toBe("listening");
    expect(byButton.turns[0]).toMatchObject({ interrupted: true, final: true });
    // Late deltas of the cancelled response don't change the interrupted turn.
    const late = voiceReducer(byButton, { type: "response.output_audio_transcript.delta", item_id: "a", delta: " more" });
    expect(late.turns[0]!.text).toBe("Let me tell you a long story");
    const byVoice = voiceReducer(speaking, { type: "input_audio_buffer.speech_started", item_id: "u" });
    expect(byVoice.turns[0]!.interrupted).toBe(true);
    expect(byVoice.learnerSpeaking).toBe(true);
  });

  it("a failure stops the session for good (no endless loading); reconnect keeps the turns", () => {
    const s = run([{ type: "local.connecting" }, { type: "local.connected" }, { type: "conversation.item.input_audio_transcription.completed", item_id: "u", transcript: "Hello" }, { type: "local.failed", message: "连接中断了" }]);
    expect(s.phase).toBe("failed");
    expect(s.error).toBe("连接中断了");
    expect(voiceReducer(s, { type: "response.created" })).toBe(s);
    const again = voiceReducer(s, { type: "local.connecting" });
    expect(again.phase).toBe("connecting");
    expect(finalTurns(again)).toHaveLength(1);
  });

  it("provider errors on a live session are warnings, not failures", () => {
    const s = run([{ type: "local.connecting" }, { type: "local.connected" }, { type: "error", error: { message: "Cancellation failed" } }]);
    expect(s.phase).toBe("thinking");
    expect(s.error).toContain("Cancellation failed");
  });
});

describe("mock voice", () => {
  it("speech is a valid silent WAV, transcription simulates silence and read-aloud", async () => {
    const wav = silentWav(0.5);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(wav.byteLength).toBe(44 + 4000);
    const mock = new MockProvider();
    expect((await mock.transcribe({ audio: new Uint8Array(10), mimeType: "audio/webm" })).text).toBe("");
    expect((await mock.transcribe({ audio: new Uint8Array(1000), mimeType: "audio/webm", expected: "Good morning. How are you?" })).text).toBe("Good morning. How are");
  });
});

describe("ending mid-sentence", () => {
  it("marks the teacher's unfinished line as interrupted", () => {
    let s = voiceReducer(initialVoiceState, { type: "local.connecting" });
    s = voiceReducer(s, { type: "local.connected" });
    s = voiceReducer(s, { type: "response.output_audio_transcript.delta", item_id: "a", delta: "Why do you" });
    s = voiceReducer(s, { type: "local.ended" });
    expect(finalTurns(s)).toEqual([{ role: "ai", text: "Why do you", interrupted: true }]);
  });
});
