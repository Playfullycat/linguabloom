import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/db/connection";
import { aiUsage, errorOccurrences, mediaAssets, speakingAttempts, users } from "@/db/schema";
import { runSeeds } from "@/db/seed";
import { getTestDatabaseUrl, truncateAll } from "@/test/db";
import { MockProvider } from "@/modules/ai/provider/mock";
import type { TextGenerationInput } from "@/modules/ai/provider/types";
import { resetRateLimit } from "@/modules/ai/services/usage";
import { getWeeklyActivity } from "@/modules/study-plan/services/activity";
import { updatePreferences } from "@/modules/learner/services/profile";

import {
  SpeakingNotFoundError,
  SpeakingRejectedError,
  attachSessionAudio,
  connectRealtime,
  deleteAllSpeaking,
  deleteSpeakingAttempt,
  deleteSpeakingAudio,
  endSpeaking,
  getSpeakingAttempt,
  latestAttemptFor,
  listSpeakingAttempts,
  requestSpeakingFeedback,
  speakingCounts,
  speakingTurn,
  synthesize,
} from "./speaking";
import { startSpeaking } from "./speaking";

// Recordings go to a throwaway directory (STORAGE_ROOT is read lazily by getEnv()).
const storage = mkdtempSync(path.join(tmpdir(), "lb-speaking-"));
process.env.STORAGE_ROOT = storage;

const url = getTestDatabaseUrl();
const { db, client } = createDb(url, { max: 4 });
let userA: string;
let userB: string;

class SpyProvider extends MockProvider {
  inputs: TextGenerationInput[] = [];
  override async generateText(input: TextGenerationInput) {
    this.inputs.push(input);
    return super.generateText(input);
  }
}
const mock = new SpyProvider();

/** Something storeAudio accepts as WebM (magic bytes) and the mock treats as speech (≥ 300 bytes). */
const webm = (size = 1200) => {
  const b = new Uint8Array(size);
  b.set([0x1a, 0x45, 0xdf, 0xa3]);
  return { bytes: b, type: "audio/webm;codecs=opus" };
};

beforeAll(async () => {
  await truncateAll(url);
  await runSeeds(url, () => {});
});

beforeEach(async () => {
  await db.delete(users);
  resetRateLimit();
  mock.inputs = [];
  [{ id: userA }] = await db.insert(users).values({ name: "A", email: "a@example.test" }).returning({ id: users.id });
  [{ id: userB }] = await db.insert(users).values({ name: "B", email: "b@example.test" }).returning({ id: users.id });
});

afterAll(async () => {
  await client.end();
  rmSync(storage, { recursive: true, force: true });
});

const start = (user: string, taskId: string, mode: "realtime" | "standard" | "typed", consent = { saveTranscript: true, saveAudio: false }) =>
  startSpeaking(db, user, { taskId, mode, ...consent }, mock);

describe("starting a session", () => {
  it("realtime with the mock provider is a simulated session at the learner's level", async () => {
    const s = await start(userA, "sp-roleplay-cafe", "realtime");
    expect(s.transport).toBe("simulated");
    expect(s.maxSeconds).toBe(600);
    expect(s.level).toBe("Pre-A1");
    const [row] = await db.select().from(speakingAttempts).where(eq(speakingAttempts.id, s.id));
    expect(row).toMatchObject({ mode: "realtime", status: "active", provider: "mock", saveAudio: false, saveTranscript: true });
  });

  it("scripted tasks need recording; missing voice models are explained", async () => {
    await expect(start(userA, "sp-read-greetings", "realtime")).rejects.toThrow(SpeakingRejectedError);
    await expect(start(userA, "sp-read-greetings", "typed")).rejects.toThrow(SpeakingRejectedError);
    const noVoice = Object.assign(new MockProvider(), { voice: { realtime: false, transcription: false, speech: false } });
    await expect(startSpeaking(db, userA, { taskId: "sp-opinion-city", mode: "realtime", saveTranscript: true, saveAudio: false }, noVoice)).rejects.toThrow(/AI_REALTIME_MODEL/);
    await expect(startSpeaking(db, userA, { taskId: "sp-opinion-city", mode: "standard", saveTranscript: true, saveAudio: false }, noVoice)).rejects.toThrow(/AI_TRANSCRIPTION_MODEL/);
    await expect(startSpeaking(db, userA, { taskId: "sp-opinion-city", mode: "typed", saveTranscript: true, saveAudio: false }, null)).rejects.toMatchObject({ code: "not_configured" });
    await expect(start(userA, "sp-nope", "typed")).rejects.toThrow(SpeakingNotFoundError);
  });

  it("typed sessions never keep audio", async () => {
    const s = await start(userA, "sp-opinion-city", "typed", { saveTranscript: true, saveAudio: true });
    const [row] = await db.select().from(speakingAttempts).where(eq(speakingAttempts.id, s.id));
    expect(row!.saveAudio).toBe(false);
  });
});

describe("realtime connection", () => {
  it("exchanges SDP server-side, records usage and limits reconnects", async () => {
    const s = await start(userA, "sp-roleplay-cafe", "realtime");
    const r = await connectRealtime(db, userA, s.id, "mock-offer", mock);
    expect(r).toEqual({ answerSdp: "mock-answer" });
    const [row] = await db.select().from(speakingAttempts).where(eq(speakingAttempts.id, s.id));
    expect(row!.connectCount).toBe(1);
    expect(row!.credentialExpiresAt).toBeInstanceOf(Date);
    const usage = await db.select().from(aiUsage).where(eq(aiUsage.userId, userA));
    expect(usage.map((u) => u.task)).toEqual(["speaking_realtime"]);
    await connectRealtime(db, userA, s.id, "mock-offer", mock);
    await connectRealtime(db, userA, s.id, "mock-offer", mock);
    await expect(connectRealtime(db, userA, s.id, "mock-offer", mock)).rejects.toThrow(/重新连接的次数太多/);
  });

  it("is owner-only, refuses ended or non-realtime sessions, and is rate limited", async () => {
    const s = await start(userA, "sp-roleplay-cafe", "realtime");
    await expect(connectRealtime(db, userB, s.id, "mock-offer", mock)).rejects.toThrow(SpeakingNotFoundError);
    const typed = await start(userA, "sp-roleplay-cafe", "typed");
    await expect(connectRealtime(db, userA, typed.id, "mock-offer", mock)).rejects.toThrow(SpeakingRejectedError);
    await endSpeaking(db, userA, s.id, { reason: "user", durationSeconds: 5 });
    await expect(connectRealtime(db, userA, s.id, "mock-offer", mock)).rejects.toThrow(SpeakingRejectedError);
    // 6 connections per 10 minutes per learner.
    for (let i = 0; i < 2; i += 1) {
      const a = await start(userA, "sp-opinion-city", "realtime");
      for (let j = 0; j < 3; j += 1) await connectRealtime(db, userA, a.id, "mock-offer", mock);
    }
    const c = await start(userA, "sp-opinion-city", "realtime");
    await expect(connectRealtime(db, userA, c.id, "mock-offer", mock)).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("a real provider gets only a well-formed SDP offer", async () => {
    const s = await start(userA, "sp-roleplay-cafe", "realtime");
    const fakeReal = Object.assign(new MockProvider(), { name: "openai" as const });
    await expect(connectRealtime(db, userA, s.id, "not sdp", fakeReal)).rejects.toThrow(/格式不正确/);
  });

  it("ending stores the transcript only with consent, with interruptions marked", async () => {
    const turns = [
      { role: "ai" as const, text: "Hi! What can I get you?", interrupted: true },
      { role: "learner" as const, text: "Can I have a coffee, please?" },
      { role: "ai" as const, text: "Sure. Small or large?" },
      { role: "learner" as const, text: "Small, please." },
    ];
    const kept = await start(userA, "sp-roleplay-cafe", "realtime");
    await endSpeaking(db, userA, kept.id, { reason: "user", durationSeconds: 95, turns });
    const notKept = await start(userA, "sp-roleplay-cafe", "realtime", { saveTranscript: false, saveAudio: false });
    await endSpeaking(db, userA, notKept.id, { reason: "disconnected", durationSeconds: 99999, turns });
    const [a] = await db.select().from(speakingAttempts).where(eq(speakingAttempts.id, kept.id));
    const [b] = await db.select().from(speakingAttempts).where(eq(speakingAttempts.id, notKept.id));
    expect(a).toMatchObject({ status: "ended", learnerTurns: 2, learnerWords: 8, durationSeconds: 95, endReason: "user" });
    expect(a!.transcript.map((t) => t.text)).toEqual(turns.map((t) => t.text));
    expect(a!.transcript[0]!.interrupted).toBe(true);
    expect(b).toMatchObject({ learnerTurns: 2, transcript: [], durationSeconds: 660, endReason: "disconnected" });
    // Ending twice is harmless.
    expect(await endSpeaking(db, userA, kept.id, { reason: "user", durationSeconds: 1 })).toEqual({ alreadyEnded: true });
  });
});

describe("standard mode turns", () => {
  it("transcribes, replies at the learner's level, and saves text/audio per consent", async () => {
    const s = await start(userA, "sp-answer-free-time", "standard", { saveTranscript: true, saveAudio: true });
    const r = await speakingTurn(db, userA, s.id, { audio: webm(), history: [] }, mock);
    expect(r.silent).toBe(false);
    expect(r.learnerText).toContain("She like reading");
    expect(r.aiText).toContain("（模拟）");
    expect(r.audioAssetId).toBeTruthy();
    const reply = mock.inputs.find((i) => i.task === "speaking_reply")!;
    expect(reply.system).toContain("LEVEL: Pre-A1");
    expect(reply.messages[0]).toEqual({ role: "assistant", content: expect.stringContaining("free time") });
    const [row] = await db.select().from(speakingAttempts).where(eq(speakingAttempts.id, s.id));
    expect(row!.learnerTurns).toBe(1);
    expect(row!.transcript.map((t) => t.role)).toEqual(["learner", "ai"]);
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, r.audioAssetId!));
    expect(asset).toMatchObject({ kind: "speaking", mimeType: "audio/webm", userId: userA });
    expect(existsSync(path.join(storage, asset!.storagePath))).toBe(true);
  });

  it("without consent nothing is kept but the counts", async () => {
    const s = await start(userA, "sp-answer-free-time", "standard", { saveTranscript: false, saveAudio: false });
    const r = await speakingTurn(db, userA, s.id, { audio: webm(), history: [] }, mock);
    expect(r.audioAssetId).toBeNull();
    const [row] = await db.select().from(speakingAttempts).where(eq(speakingAttempts.id, s.id));
    expect(row).toMatchObject({ learnerTurns: 1, transcript: [], audioAssetIds: [] });
    expect(await db.select().from(mediaAssets)).toHaveLength(0);
  });

  it("silence is not counted; a standard session can fall back to typing", async () => {
    const s = await start(userA, "sp-answer-free-time", "standard");
    const silent = await speakingTurn(db, userA, s.id, { audio: { bytes: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), type: "audio/webm" }, history: [] }, mock);
    expect(silent).toMatchObject({ silent: true, learnerText: "" });
    const typed = await speakingTurn(db, userA, s.id, { text: "I play football on weekends.", history: [] }, mock);
    expect(typed.learnerText).toBe("I play football on weekends.");
    const [row] = await db.select().from(speakingAttempts).where(eq(speakingAttempts.id, s.id));
    expect(row!.learnerTurns).toBe(1);
    await expect(speakingTurn(db, userA, s.id, { history: [] }, mock)).rejects.toThrow(SpeakingRejectedError);
  });

  it("a failed reply keeps the learner's turn and says why", async () => {
    const s = await start(userA, "sp-opinion-city", "typed");
    const r = await speakingTurn(db, userA, s.id, { text: "I prefer the city [mock:error:timeout]", history: [] }, mock);
    expect(r.aiText).toBeNull();
    expect(r.replyError?.code).toBe("timeout");
    const [row] = await db.select().from(speakingAttempts).where(eq(speakingAttempts.id, s.id));
    expect(row!.learnerTurns).toBe(1);
  });

  it("the teacher closes after max turns, then no more turns", async () => {
    const s = await start(userA, "sp-answer-about-me", "typed");
    const history: { role: "learner" | "ai"; text: string }[] = [];
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await speakingTurn(db, userA, s.id, { text: `Answer number ${i + 1}.`, history }, mock);
      history.push({ role: "learner", text: last.learnerText }, { role: "ai", text: last.aiText ?? "" });
    }
    expect(last!.final).toBe(true);
    expect(mock.inputs.at(-1)!.system).toContain("LAST turn");
    await expect(speakingTurn(db, userA, s.id, { text: "One more.", history }, mock)).rejects.toThrow(/说完了/);
  });

  it("scripted tasks compare each sentence with what was heard", async () => {
    const s = await start(userA, "sp-read-greetings", "standard");
    await expect(speakingTurn(db, userA, s.id, { audio: webm(), history: [] }, mock)).rejects.toThrow(/找不到这一句/);
    const r = await speakingTurn(db, userA, s.id, { audio: webm(), item: 1, history: [] }, mock);
    expect(r.aiText).toBeNull();
    expect(r.learnerText).toBe("Good morning. How are");
    expect(r.comparison).toMatchObject({ heard: 4, total: 5 });
    const [row] = await db.select().from(speakingAttempts).where(eq(speakingAttempts.id, s.id));
    expect(row!.transcript[0]).toMatchObject({ item: 1, score: 0.8 });
    await expect(speakingTurn(db, userA, s.id, { text: "typed", item: 0, history: [] }, mock)).rejects.toThrow(/需要录音/);
  });

  it("refuses other users, ended sessions and oversized audio", async () => {
    const s = await start(userA, "sp-opinion-city", "standard");
    await expect(speakingTurn(db, userB, s.id, { audio: webm(), history: [] }, mock)).rejects.toThrow(SpeakingNotFoundError);
    await expect(speakingTurn(db, userA, s.id, { audio: webm(6 * 1024 * 1024), history: [] }, mock)).rejects.toThrow(/太长/);
    await endSpeaking(db, userA, s.id, { reason: "user", durationSeconds: 10 });
    await expect(speakingTurn(db, userA, s.id, { audio: webm(), history: [] }, mock)).rejects.toThrow(/结束/);
  });
});

describe("feedback", () => {
  it("is validated, recorded with confidence, and real mistakes go to the error notebook", async () => {
    const s = await start(userA, "sp-answer-free-time", "standard");
    await speakingTurn(db, userA, s.id, { audio: webm(), history: [] }, mock);
    await speakingTurn(db, userA, s.id, { audio: webm(), history: [] }, mock);
    await endSpeaking(db, userA, s.id, { reason: "completed", durationSeconds: 60 });
    const f = await requestSpeakingFeedback(db, userA, s.id, undefined, mock);
    expect(f.confidence).toBe("medium");
    expect(f.grammar[0]).toMatchObject({ original: expect.stringContaining("She like reading") });
    expect(f.pronunciation_note_zh).toContain("没有评价发音");
    const prompt = mock.inputs.find((i) => i.task === "speaking_feedback")!;
    expect(prompt.messages[0]!.content).toContain("LEARNER: She like reading");
    const occ = await db.select().from(errorOccurrences).where(and(eq(errorOccurrences.userId, userA), eq(errorOccurrences.source, "speaking")));
    expect(occ.length).toBeGreaterThan(0);
    // Asking again returns the stored feedback without another AI call.
    const calls = mock.inputs.length;
    await requestSpeakingFeedback(db, userA, s.id, undefined, mock);
    expect(mock.inputs.length).toBe(calls);
  });

  it("without a saved transcript the browser's copy is used once; later it can't be redone", async () => {
    const s = await start(userA, "sp-opinion-city", "typed", { saveTranscript: false, saveAudio: false });
    await speakingTurn(db, userA, s.id, { text: "I prefer the city because it is busy.", history: [] }, mock);
    await endSpeaking(db, userA, s.id, { reason: "user", durationSeconds: 30 });
    await expect(requestSpeakingFeedback(db, userA, s.id, undefined, mock)).rejects.toThrow(/没有保存转录/);
    const f = await requestSpeakingFeedback(db, userA, s.id, [{ role: "learner", text: "I prefer the city because it is busy." }], mock);
    expect(f.confidence).toBe("low");
    const [row] = await db.select().from(speakingAttempts).where(eq(speakingAttempts.id, s.id));
    expect(row!.transcript).toEqual([]);
    expect(row!.evaluation).not.toBeNull();
  });

  it("needs an ended session with something said", async () => {
    const s = await start(userA, "sp-opinion-city", "typed");
    await expect(requestSpeakingFeedback(db, userA, s.id, undefined, mock)).rejects.toThrow(/先结束/);
    await endSpeaking(db, userA, s.id, { reason: "user", durationSeconds: 3 });
    await expect(requestSpeakingFeedback(db, userA, s.id, undefined, mock)).rejects.toThrow(/没有录到/);
  });
});

describe("recordings, deletion and privacy", () => {
  it("a realtime session recording is attached only with consent, once", async () => {
    const no = await start(userA, "sp-roleplay-cafe", "realtime");
    await expect(attachSessionAudio(db, userA, no.id, webm())).rejects.toThrow(/没有同意/);
    const yes = await start(userA, "sp-roleplay-cafe", "realtime", { saveTranscript: true, saveAudio: true });
    await attachSessionAudio(db, userA, yes.id, webm());
    await expect(attachSessionAudio(db, userA, yes.id, webm())).rejects.toThrow(/已经保存过/);
    await expect(attachSessionAudio(db, userA, yes.id, { bytes: new Uint8Array(2000), type: "audio/webm" })).rejects.toThrow();
  });

  it("deleting audio removes files and rows together; deleting a session removes everything", async () => {
    const s = await start(userA, "sp-answer-free-time", "standard", { saveTranscript: true, saveAudio: true });
    await speakingTurn(db, userA, s.id, { audio: webm(), history: [] }, mock);
    await speakingTurn(db, userA, s.id, { audio: webm(), history: [] }, mock);
    const { media } = await getSpeakingAttempt(db, userA, s.id);
    expect(media).toHaveLength(2);
    const paths = (await db.select().from(mediaAssets)).map((m) => path.join(storage, m.storagePath));
    expect(paths.every((p) => existsSync(p))).toBe(true);

    await expect(deleteSpeakingAudio(db, userB, s.id)).rejects.toThrow(SpeakingNotFoundError);
    expect(await deleteSpeakingAudio(db, userA, s.id)).toBe(2);
    expect(paths.some((p) => existsSync(p))).toBe(false);
    expect(await db.select().from(mediaAssets)).toHaveLength(0);
    const after = await getSpeakingAttempt(db, userA, s.id);
    expect(after.attempt.audioAssetIds).toEqual([]);
    expect(after.attempt.transcript.length).toBeGreaterThan(0);

    await speakingTurn(db, userA, s.id, { audio: webm(), history: [] }, mock);
    await deleteSpeakingAttempt(db, userA, s.id);
    expect(await db.select().from(speakingAttempts)).toHaveLength(0);
    expect(await db.select().from(mediaAssets)).toHaveLength(0);
  });

  it("lists, counts and deletes all — only the owner's", async () => {
    const a1 = await start(userA, "sp-answer-free-time", "standard", { saveTranscript: true, saveAudio: true });
    await speakingTurn(db, userA, a1.id, { audio: webm(), history: [] }, mock);
    await start(userA, "sp-opinion-city", "typed");
    const b1 = await start(userB, "sp-opinion-city", "typed");
    expect((await listSpeakingAttempts(db, userA)).map((r) => r.promptId).sort()).toEqual(["sp-answer-free-time", "sp-opinion-city"]);
    expect(await speakingCounts(db, userA)).toEqual({ sessions: 2, recordings: 1 });
    expect((await latestAttemptFor(db, userA, "sp-opinion-city"))?.status).toBe("active");
    await expect(getSpeakingAttempt(db, userA, b1.id)).rejects.toThrow(SpeakingNotFoundError);
    expect(await deleteAllSpeaking(db, userA)).toEqual({ sessions: 2, recordings: 1 });
    expect(await speakingCounts(db, userB)).toEqual({ sessions: 1, recordings: 0 });
  });

  it("speaking preferences default to no audio and transcripts on", async () => {
    const { getLearnerSettings } = await import("@/modules/learner/services/profile");
    const { preferences } = await getLearnerSettings(db, userA);
    expect(preferences).toMatchObject({ saveSpeakingAudio: false, saveSpeakingTranscripts: true });
    await updatePreferences(db, userA, { saveSpeakingAudio: true });
    expect((await getLearnerSettings(db, userA)).preferences.saveSpeakingAudio).toBe(true);
  });
});

describe("speech and activity", () => {
  it("synthesizes speech (cached) and refuses empty or long text", async () => {
    const a = await synthesize(db, userA, "（模拟）Hello there!", false, mock);
    expect(a.mimeType).toBe("audio/wav");
    await synthesize(db, userA, "Hello there!", false, mock);
    const usage = await db.select().from(aiUsage).where(and(eq(aiUsage.userId, userA), eq(aiUsage.task, "speech")));
    expect(usage).toHaveLength(1);
    await expect(synthesize(db, userA, "   ", false, mock)).rejects.toThrow(SpeakingRejectedError);
    await expect(synthesize(db, userA, "x".repeat(700), false, mock)).rejects.toThrow(SpeakingRejectedError);
  });

  it("finished sessions count as output practice this week", async () => {
    const s = await start(userA, "sp-opinion-city", "typed");
    await speakingTurn(db, userA, s.id, { text: "I like the city.", history: [] }, mock);
    await endSpeaking(db, userA, s.id, { reason: "user", durationSeconds: 300 });
    const week = await getWeeklyActivity(db, userA, new Date(), "Asia/Shanghai");
    expect(week.byStrand.meaning_focused_output).toBe(5);
    expect(week.lastActivityAt).not.toBeNull();
  });
});
