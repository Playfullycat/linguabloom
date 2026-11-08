import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/connection";
import { learningContents, mediaAssets, speakingAttempts, transcriptSegments, type ErrorCategory, type SpeakingTranscriptEntry } from "@/db/schema";
import { getEnv, type Env } from "@/lib/config/env";
import { removeStored, storeAudio } from "@/lib/storage";
import { cachedSpeech } from "@/modules/audio/tts-cache";
import { getAIProvider } from "@/modules/ai/provider";
import { AIError } from "@/modules/ai/provider/errors";
import type { AIProvider } from "@/modules/ai/provider/types";
import { checkNamedLimit, runAI } from "@/modules/ai/services/usage";
import { CEFR_LEVEL_LABELS } from "@/modules/curriculum/domain/cefr";
import { recordError } from "@/modules/errors/services/errors";
import { ERROR_CATEGORY_LABELS } from "@/modules/grammar/content";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { learnerInputLevel } from "@/modules/materials/services/materials";
import { countWords } from "@/modules/writing/content";

import { getSpeakingTask, isScripted, type SpeakingTask } from "../content";
import { compareReading, type Comparison } from "../domain/compare";
import { parseSpeakingFeedback, type SpeakingFeedback } from "../domain/feedback";
import { feedbackSystemPrompt, transcriptForFeedback, voiceTeacherInstructions, withSource, type Turn, type VoiceContext } from "../domain/prompts";

/**
 * Speaking Lab (spec §5.10, §7.7). Three ways to practise, all saved the same way:
 * - realtime: WebRTC voice with the provider; the server exchanges SDP using a
 *   fresh short-lived credential (never sent to the browser);
 * - standard ("标准语音模式"): record → transcribe → text model reply → speech;
 * - typed: no microphone, the learner types (conversation tasks only).
 * Transcripts and recordings are saved only with the consent chosen before
 * starting; recordings are off by default.
 */

export class SpeakingNotFoundError extends Error {}
/** A request the learner can fix; `message` is shown as is (Chinese). */
export class SpeakingRejectedError extends Error {}

export type SpeakingMode = "realtime" | "standard" | "typed";
export type EndReason = "completed" | "user" | "disconnected" | "time_limit" | "error";

export const MAX_TURN_AUDIO_BYTES = 5 * 1024 * 1024;
export const MAX_SESSION_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_TURN_TEXT = 1000;
export const MAX_SPEECH_TEXT = 600;
const VOICE_CONNECT_LIMIT = { requests: 6, windowMs: 10 * 60_000 };
const MAX_CONNECTS_PER_ATTEMPT = 3;

async function voiceContext(db: DbExecutor, userId: string): Promise<VoiceContext & { timeZone: string }> {
  const [{ profile }, { level }] = await Promise.all([getLearnerSettings(db, userId), learnerInputLevel(db, userId, "listening")]);
  const explanation = (["zh", "mixed", "en"].includes(profile.explanationLanguage) ? profile.explanationLanguage : "zh") as VoiceContext["explanationLanguage"];
  return { level: CEFR_LEVEL_LABELS[level], explanationLanguage: explanation, timeZone: profile.timezone };
}

/** The built-in material a retelling task is about. */
export async function speakingSource(db: DbExecutor, task: SpeakingTask) {
  if (!task.source_material) return null;
  const [content] = await db
    .select({ id: learningContents.id, title: learningContents.titleEn, type: learningContents.type })
    .from(learningContents)
    .where(and(eq(learningContents.id, task.source_material), isNull(learningContents.ownerUserId), isNull(learningContents.archivedAt)));
  if (!content) return null;
  const rows = await db
    .select({ speaker: transcriptSegments.speaker, en: transcriptSegments.textEn, zh: transcriptSegments.textZh })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.contentId, content.id))
    .orderBy(asc(transcriptSegments.sequence));
  return { id: content.id, type: content.type, title: content.title, rows, lines: rows.map((r) => (r.speaker ? `${r.speaker}: ${r.en}` : r.en)) };
}

function requireTask(id: string) {
  const task = getSpeakingTask(id);
  if (!task) throw new SpeakingNotFoundError(id);
  return task;
}

async function ownedAttempt(db: DbExecutor, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(speakingAttempts)
    .where(and(eq(speakingAttempts.id, id), eq(speakingAttempts.userId, userId)));
  if (!row) throw new SpeakingNotFoundError(id);
  return row;
}

function resolveProvider(provider: AIProvider | null | undefined, env: Env) {
  const p = provider === undefined ? getAIProvider(env) : provider;
  if (!p) throw new AIError("not_configured");
  return p;
}

export type StartInput = { taskId: string; mode: SpeakingMode; saveTranscript: boolean; saveAudio: boolean };

export async function startSpeaking(db: DbExecutor, userId: string, input: StartInput, provider?: AIProvider | null, env: Env = getEnv()) {
  const task = requireTask(input.taskId);
  if (isScripted(task.type) && input.mode !== "standard") throw new SpeakingRejectedError("这个任务需要录音：逐句录下来，再转写对照。");
  const p = resolveProvider(provider, env);
  if (input.mode === "realtime" && !p.voice.realtime) throw new SpeakingRejectedError("实时语音没有配置（需要 AI_REALTIME_MODEL）。可以改用标准语音模式。");
  if (input.mode === "standard" && !p.voice.transcription) throw new SpeakingRejectedError("语音转写没有配置（需要 AI_TRANSCRIPTION_MODEL）。可以改用文字回答。");
  const ctx = await voiceContext(db, userId);
  const [row] = await db
    .insert(speakingAttempts)
    .values({
      userId,
      taskType: task.type,
      promptId: task.id,
      mode: input.mode,
      provider: p.name,
      model: input.mode === "realtime" ? (p.name === "mock" ? "mock-realtime" : (env.AI_REALTIME_MODEL ?? "")) : p.textModel,
      level: ctx.level,
      saveTranscript: input.saveTranscript,
      // Typed answers have no audio to keep.
      saveAudio: input.mode !== "typed" && input.saveAudio,
    })
    .returning({ id: speakingAttempts.id });
  return {
    id: row!.id,
    level: ctx.level,
    transport: input.mode === "realtime" ? (p.name === "mock" ? ("simulated" as const) : ("webrtc" as const)) : null,
    maxSeconds: env.AI_REALTIME_MAX_MINUTES * 60,
    speech: p.voice.speech,
  };
}

/**
 * The browser's SDP offer → the provider's answer. Each call mints a new
 * credential that lives ~60 s and is used exactly once, here on the server.
 */
export async function connectRealtime(db: DbExecutor, userId: string, attemptId: string, offerSdp: string, provider?: AIProvider | null, env: Env = getEnv()) {
  const a = await ownedAttempt(db, userId, attemptId);
  if (a.mode !== "realtime" || a.status !== "active") throw new SpeakingRejectedError("这次练习已经结束了，请重新开始。");
  if (a.connectCount >= MAX_CONNECTS_PER_ATTEMPT) throw new SpeakingRejectedError("这次练习重新连接的次数太多了。请结束后重新开始，或者改用标准语音模式。");
  const p = resolveProvider(provider, env);
  if (offerSdp.length > 20_000 || (p.name !== "mock" && !offerSdp.startsWith("v="))) throw new SpeakingRejectedError("连接请求的格式不正确。");
  checkNamedLimit(`voice:${userId}`, VOICE_CONNECT_LIMIT);
  const task = requireTask(a.promptId);
  const ctx = await voiceContext(db, userId);
  const source = await speakingSource(db, task);
  const instructions = withSource(voiceTeacherInstructions(task, { ...ctx, level: a.level }, { realtime: true }), source);
  const { value } = await runAI({ db, userId, task: "speaking_realtime", timeZone: ctx.timeZone, provider: p, env, unpriced: true }, async (ai) => {
    const r = await ai.connectRealtime({ offerSdp, instructions, voice: env.AI_VOICE });
    return { value: r, usage: { inputTokens: 0, outputTokens: 0 }, model: r.model };
  });
  await db
    .update(speakingAttempts)
    .set({ connectCount: sql`${speakingAttempts.connectCount} + 1`, credentialExpiresAt: value.credentialExpiresAt, model: value.model })
    .where(eq(speakingAttempts.id, a.id));
  return { answerSdp: value.answerSdp };
}

const turnSchemaLimit = (turns: (Turn & { interrupted?: boolean })[]) =>
  turns
    .filter((t) => (t.role === "learner" || t.role === "ai") && typeof t.text === "string" && t.text.trim() !== "")
    .slice(-40)
    .map((t) => ({ role: t.role, text: t.text.trim().slice(0, MAX_TURN_TEXT), item: t.item, interrupted: t.interrupted === true }));

export type TurnInput = {
  audio?: { bytes: Uint8Array; type: string };
  text?: string;
  /** Scripted tasks: which sentence. */
  item?: number;
  /** Earlier turns of this session (after the opening line), kept by the browser. */
  history: Turn[];
};

export type TurnResult = {
  learnerText: string;
  /** Nothing was recognised: not counted, ask again. */
  silent: boolean;
  aiText: string | null;
  /** The reply failed (the learner's turn is still saved). */
  replyError: AIError | null;
  comparison: Comparison | null;
  /** The teacher closed the conversation: time to end and see feedback. */
  final: boolean;
  audioAssetId: string | null;
};

async function saveRecording(db: DbExecutor, userId: string, attemptId: string, audio: { bytes: Uint8Array; type: string }, name: string) {
  const type = audio.type.split(";")[0]!.trim();
  const file = await storeAudio(userId, { type, bytes: audio.bytes });
  try {
    const [asset] = await db
      .insert(mediaAssets)
      .values({ userId, kind: "speaking", mimeType: type, sizeBytes: file.size, storagePath: file.relative, originalName: name, sha256: file.sha256 })
      .returning({ id: mediaAssets.id });
    await db
      .update(speakingAttempts)
      .set({ audioAssetIds: sql`${speakingAttempts.audioAssetIds} || ${JSON.stringify([asset!.id])}::jsonb` })
      .where(eq(speakingAttempts.id, attemptId));
    return asset!.id;
  } catch (error) {
    await removeStored(file.relative);
    throw error;
  }
}

/** One learner turn in standard or typed mode. */
export async function speakingTurn(db: Database, userId: string, attemptId: string, input: TurnInput, provider?: AIProvider | null, now = new Date(), env: Env = getEnv()): Promise<TurnResult> {
  const a = await ownedAttempt(db, userId, attemptId);
  if (a.status !== "active" || a.mode === "realtime") throw new SpeakingRejectedError("这次练习已经结束了。");
  const task = requireTask(a.promptId);
  const scripted = isScripted(task.type);
  const items = task.items ?? [];
  if (scripted && (input.item === undefined || !Number.isInteger(input.item) || input.item < 0 || input.item >= items.length)) throw new SpeakingRejectedError("找不到这一句。");
  // Typed sessions never send audio; a standard session may fall back to typing (e.g. the microphone stopped working).
  if (a.mode === "typed") input = { ...input, audio: undefined };
  if (scripted && !input.audio) throw new SpeakingRejectedError("这个任务需要录音。");
  if (!input.audio && !input.text?.trim()) throw new SpeakingRejectedError(a.mode === "typed" ? "先写下你想说的话。" : "没有收到录音。");
  const limit = scripted ? items.length * 3 : task.max_turns;
  if (a.learnerTurns >= limit) throw new SpeakingRejectedError("这次练习已经说完了，结束后就能看到反馈。");
  if (input.audio && input.audio.bytes.byteLength > MAX_TURN_AUDIO_BYTES) throw new SpeakingRejectedError("这段录音太长了，请控制在一分钟以内。");

  const p = resolveProvider(provider, env);
  const ctx = await voiceContext(db, userId);
  let learnerText: string;
  if (input.audio) {
    const audio = input.audio;
    const { value } = await runAI({ db, userId, task: "transcription", timeZone: ctx.timeZone, provider: p, env, unpriced: true }, async (ai) => {
      const r = await ai.transcribe({ audio: audio.bytes, mimeType: audio.type, hint: task.key_phrases.join(", "), expected: scripted ? items[input.item!] : undefined });
      return { value: r.text, usage: r.usage, model: r.model };
    });
    learnerText = value.trim().slice(0, MAX_TURN_TEXT);
  } else learnerText = input.text!.trim().slice(0, MAX_TURN_TEXT);

  if (learnerText === "") return { learnerText: "", silent: true, aiText: null, replyError: null, comparison: null, final: false, audioAssetId: null };

  const audioAssetId = a.saveAudio && input.audio ? await saveRecording(db, userId, a.id, input.audio, `${task.id}-${a.learnerTurns + 1}`) : null;
  const comparison = scripted ? compareReading(items[input.item!]!, learnerText) : null;

  let aiText: string | null = null;
  let replyError: AIError | null = null;
  const final = !scripted && a.learnerTurns + 1 >= task.max_turns;
  if (!scripted) {
    const source = await speakingSource(db, task);
    const history = turnSchemaLimit(input.history);
    try {
      const { value } = await runAI({ db, userId, task: "speaking_reply", timeZone: ctx.timeZone, provider: p, env }, async (ai) => {
        const r = await ai.generateText({
          task: "speaking_reply",
          system: withSource(voiceTeacherInstructions(task, { ...ctx, level: a.level }, { realtime: false, finalTurn: final }), source),
          messages: [
            { role: "assistant", content: task.opening_en! },
            ...history.map((t) => ({ role: t.role === "ai" ? ("assistant" as const) : ("user" as const), content: t.text })),
            { role: "user", content: learnerText },
          ],
          json: false,
          maxOutputTokens: 220,
        });
        return { value: r.text, usage: r.usage, model: r.model };
      });
      aiText = value.replace(/\s+/g, " ").trim().slice(0, MAX_SPEECH_TEXT) || null;
    } catch (error) {
      replyError = error instanceof AIError ? error : new AIError("unknown");
    }
  }

  const entries: SpeakingTranscriptEntry[] = [{ role: "learner", text: learnerText, at: now.toISOString(), ...(scripted ? { item: input.item, score: comparison!.score } : {}) }];
  if (aiText) entries.push({ role: "ai", text: aiText, at: new Date(now.getTime() + 1).toISOString() });
  await db
    .update(speakingAttempts)
    .set({
      learnerTurns: sql`${speakingAttempts.learnerTurns} + 1`,
      learnerWords: sql`${speakingAttempts.learnerWords} + ${countWords(learnerText)}`,
      ...(a.saveTranscript ? { transcript: sql`${speakingAttempts.transcript} || ${JSON.stringify(entries)}::jsonb` } : {}),
    })
    .where(eq(speakingAttempts.id, a.id));

  return { learnerText, silent: false, aiText, replyError, comparison, final, audioAssetId };
}

/** The teacher's line (or a sentence to repeat) as speech, from the shared file cache (heard many times, paid once). */
export async function synthesize(db: DbExecutor, userId: string, text: string, slow: boolean, provider?: AIProvider | null, env: Env = getEnv()) {
  const clean = text.replace(/（模拟）/g, "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > MAX_SPEECH_TEXT) throw new SpeakingRejectedError("要朗读的文字太长或为空。");
  const p = resolveProvider(provider, env);
  if (!p.voice.speech) throw new SpeakingRejectedError("语音合成没有配置（需要 AI_TTS_MODEL）。");
  return cachedSpeech(db, userId, clean, { slow }, p, env);
}

export type EndInput = {
  reason: EndReason;
  durationSeconds: number;
  /** Realtime: the transcript as received over the data channel. Other modes: the browser's copy (used only for feedback when transcripts aren't saved). */
  turns?: (Turn & { interrupted?: boolean })[];
};

/** End a session (idempotent). Realtime transcripts are stored here, if the learner agreed. */
export async function endSpeaking(db: DbExecutor, userId: string, attemptId: string, input: EndInput, now = new Date(), env: Env = getEnv()) {
  const a = await ownedAttempt(db, userId, attemptId);
  if (a.status === "ended") return { alreadyEnded: true };
  const duration = Math.max(0, Math.min(Math.round(input.durationSeconds), env.AI_REALTIME_MAX_MINUTES * 60 + 60));
  const patch: Partial<typeof speakingAttempts.$inferInsert> = { status: "ended", endedAt: now, durationSeconds: duration, endReason: input.reason };
  if (a.mode === "realtime") {
    const turns = turnSchemaLimit(input.turns ?? []);
    const learner = turns.filter((t) => t.role === "learner");
    patch.learnerTurns = learner.length;
    patch.learnerWords = learner.reduce((n, t) => n + countWords(t.text), 0);
    if (a.saveTranscript) patch.transcript = turns.map((t, i) => ({ role: t.role, text: t.text, at: new Date(now.getTime() - (turns.length - i)).toISOString(), ...(t.interrupted ? { interrupted: true } : {}) }));
  }
  await db.update(speakingAttempts).set(patch).where(eq(speakingAttempts.id, a.id));
  return { alreadyEnded: false };
}

async function recordSpeakingErrors(db: DbExecutor, userId: string, attemptId: string, feedback: SpeakingFeedback) {
  if (feedback.confidence === "low") return 0;
  let n = 0;
  for (const g of feedback.grammar.filter((x) => x.severity !== "low")) {
    await recordError(db, userId, {
      category: g.category as ErrorCategory,
      pointType: "speaking",
      pointId: g.category,
      title: `${ERROR_CATEGORY_LABELS[g.category as keyof typeof ERROR_CATEGORY_LABELS] ?? g.category}（口语）`,
      source: "speaking",
      sourceRef: attemptId,
      wrong: g.original,
      correct: g.corrected,
    });
    n += 1;
  }
  return n;
}

/**
 * Feedback after the session. Uses the saved transcript, or — when the learner
 * chose not to save it — the browser's copy for this one request only.
 */
export async function requestSpeakingFeedback(db: Database, userId: string, attemptId: string, browserTurns?: Turn[], provider?: AIProvider | null, env: Env = getEnv()) {
  const a = await ownedAttempt(db, userId, attemptId);
  if (a.status !== "ended") throw new SpeakingRejectedError("先结束这次练习。");
  if (a.evaluation) return a.evaluation as SpeakingFeedback;
  const task = requireTask(a.promptId);
  const turns: Turn[] = a.transcript.length > 0 ? a.transcript.map((t) => ({ role: t.role, text: t.text, item: t.item })) : turnSchemaLimit(browserTurns ?? []);
  const learner = turns.filter((t) => t.role === "learner");
  if (learner.length === 0) throw new SpeakingRejectedError(a.saveTranscript ? "这次没有录到你说的话，所以没有反馈。" : "没有保存转录，现在已经无法生成反馈。下次可以开启「保存转录」。");
  const p = resolveProvider(provider, env);
  const ctx = await voiceContext(db, userId);
  const vctx = { ...ctx, level: a.level };
  const learnerText = learner.map((t) => t.text).join(" ");
  const words = countWords(learnerText);
  const { value } = await runAI({ db, userId, task: "speaking_feedback", timeZone: ctx.timeZone, provider: p, env }, async (ai) => {
    const r = await ai.generateText({
      task: "speaking_feedback",
      system: feedbackSystemPrompt(task, vctx),
      messages: [{ role: "user", content: transcriptForFeedback(task, turns, { durationSeconds: a.durationSeconds }) }],
      json: true,
      maxOutputTokens: Math.max(env.AI_MAX_OUTPUT_TOKENS, 1200),
    });
    return { value: parseSpeakingFeedback(r.text, learnerText, words), usage: r.usage, model: r.model };
  });
  const feedback = value.feedback;
  await db.update(speakingAttempts).set({ evaluation: feedback, confidence: feedback.confidence }).where(eq(speakingAttempts.id, a.id));
  await recordSpeakingErrors(db, userId, a.id, feedback);
  return feedback;
}

/** Realtime: the learner's own microphone for the whole session, uploaded at the end (only with consent). */
export async function attachSessionAudio(db: DbExecutor, userId: string, attemptId: string, audio: { bytes: Uint8Array; type: string }) {
  const a = await ownedAttempt(db, userId, attemptId);
  if (!a.saveAudio) throw new SpeakingRejectedError("这次练习没有同意保存录音。");
  if (a.mode !== "realtime" || a.audioAssetIds.length > 0) throw new SpeakingRejectedError("这次练习的录音已经保存过了。");
  if (audio.bytes.byteLength > MAX_SESSION_AUDIO_BYTES) throw new SpeakingRejectedError("录音文件太大了。");
  return saveRecording(db, userId, a.id, audio, `${a.promptId}-session`);
}

export async function listSpeakingAttempts(db: DbExecutor, userId: string, limit = 30) {
  const rows = await db
    .select({
      id: speakingAttempts.id,
      promptId: speakingAttempts.promptId,
      taskType: speakingAttempts.taskType,
      mode: speakingAttempts.mode,
      status: speakingAttempts.status,
      level: speakingAttempts.level,
      learnerTurns: speakingAttempts.learnerTurns,
      learnerWords: speakingAttempts.learnerWords,
      durationSeconds: speakingAttempts.durationSeconds,
      confidence: speakingAttempts.confidence,
      hasFeedback: sql<boolean>`${speakingAttempts.evaluation} is not null`,
      audioCount: sql<number>`jsonb_array_length(${speakingAttempts.audioAssetIds})::int`,
      transcriptSaved: speakingAttempts.saveTranscript,
      endReason: speakingAttempts.endReason,
      createdAt: speakingAttempts.createdAt,
    })
    .from(speakingAttempts)
    .where(eq(speakingAttempts.userId, userId))
    .orderBy(desc(speakingAttempts.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, task: getSpeakingTask(r.promptId) ?? null }));
}

export async function getSpeakingAttempt(db: DbExecutor, userId: string, attemptId: string) {
  const a = await ownedAttempt(db, userId, attemptId);
  const media = a.audioAssetIds.length
    ? await db
        .select({ id: mediaAssets.id, mimeType: mediaAssets.mimeType, sizeBytes: mediaAssets.sizeBytes, createdAt: mediaAssets.createdAt })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.userId, userId), inArray(mediaAssets.id, a.audioAssetIds)))
        .orderBy(asc(mediaAssets.createdAt))
    : [];
  return { attempt: a, task: getSpeakingTask(a.promptId) ?? null, evaluation: (a.evaluation as SpeakingFeedback | null) ?? null, media };
}

/** Files first, then rows: a failed file removal never leaves a row pointing at nothing it claims to hold. */
async function removeMedia(db: DbExecutor, userId: string, ids: string[]) {
  if (ids.length === 0) return 0;
  const assets = await db
    .select({ id: mediaAssets.id, path: mediaAssets.storagePath })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.userId, userId), inArray(mediaAssets.id, ids)));
  for (const asset of assets) await removeStored(asset.path);
  if (assets.length) await db.delete(mediaAssets).where(inArray(mediaAssets.id, assets.map((x) => x.id)));
  return assets.length;
}

/** Delete the recordings of one session; the transcript and feedback stay. */
export async function deleteSpeakingAudio(db: DbExecutor, userId: string, attemptId: string) {
  const a = await ownedAttempt(db, userId, attemptId);
  const n = await removeMedia(db, userId, a.audioAssetIds);
  await db.update(speakingAttempts).set({ audioAssetIds: [] }).where(eq(speakingAttempts.id, a.id));
  return n;
}

/** Delete one session with its transcript, feedback and recordings. */
export async function deleteSpeakingAttempt(db: DbExecutor, userId: string, attemptId: string) {
  const a = await ownedAttempt(db, userId, attemptId);
  await removeMedia(db, userId, a.audioAssetIds);
  await db.delete(speakingAttempts).where(eq(speakingAttempts.id, a.id));
}

/** Settings → delete every speaking session and recording. */
export async function deleteAllSpeaking(db: DbExecutor, userId: string) {
  const rows = await db.select({ ids: speakingAttempts.audioAssetIds }).from(speakingAttempts).where(eq(speakingAttempts.userId, userId));
  const files = await removeMedia(db, userId, rows.flatMap((r) => r.ids));
  const deleted = await db.delete(speakingAttempts).where(eq(speakingAttempts.userId, userId)).returning({ id: speakingAttempts.id });
  return { sessions: deleted.length, recordings: files };
}

export async function speakingCounts(db: DbExecutor, userId: string) {
  const [row] = await db
    .select({ sessions: sql<number>`count(*)::int`, recordings: sql<number>`coalesce(sum(jsonb_array_length(${speakingAttempts.audioAssetIds})), 0)::int` })
    .from(speakingAttempts)
    .where(eq(speakingAttempts.userId, userId));
  return { sessions: row?.sessions ?? 0, recordings: row?.recordings ?? 0 };
}

/** Newest session for a task (the lab page uses it to start fresh after a session ends). */
export async function latestAttemptFor(db: DbExecutor, userId: string, taskId: string) {
  const [row] = await db
    .select({ id: speakingAttempts.id, status: speakingAttempts.status })
    .from(speakingAttempts)
    .where(and(eq(speakingAttempts.userId, userId), eq(speakingAttempts.promptId, taskId)))
    .orderBy(desc(speakingAttempts.createdAt))
    .limit(1);
  return row ?? null;
}
