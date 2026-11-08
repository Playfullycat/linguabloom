import { z } from "zod";

import { getDb } from "@/db";
import { getEnv } from "@/lib/config/env";
import { getAIProvider } from "@/modules/ai/provider";
import { AIError, AI_ERROR_MESSAGES, type AIErrorCode } from "@/modules/ai/provider/errors";
import { runAI } from "@/modules/ai/services/usage";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { saveMockProgress } from "@/modules/pte/services/mock";
import { PteNotFoundError, PteRejectedError, expectedSpeech, submitAttempt } from "@/modules/pte/services/pte";
import { audioPart, guard, noStore } from "@/modules/speaking/http";

/**
 * A spoken PTE answer: the recording is transcribed by the configured
 * provider, then scored / given feedback like any other answer. The audio
 * itself is not stored — only the transcript (shown to the learner).
 */

const payloadSchema = z.object({
  promptId: z.string().regex(/^pte-[a-z0-9-]+$/),
  mode: z.enum(["practice", "timed", "mock"]),
  durationMs: z.number().min(0).max(3_600_000),
  seconds: z.number().min(0).max(600),
  timedOut: z.boolean(),
  clientRequestId: z.uuid(),
  mockTestId: z.uuid().optional(),
  elapsedSeconds: z.number().min(0).max(36_000).optional(),
});

const MAX_AUDIO = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const g = await guard(request);
  if ("response" in g) return g.response;
  const form = await request.formData().catch(() => null);
  let raw: unknown = null;
  try {
    raw = form ? JSON.parse(String(form.get("payload") ?? "null")) : null;
  } catch {
    raw = null;
  }
  const payload = payloadSchema.safeParse(raw);
  if (!form || !payload.success) return Response.json({ error: "提交的答案格式不正确。" }, { status: 400 });
  const audio = await audioPart(form);
  if (!audio) return Response.json({ error: "没有收到录音。" }, { status: 400 });
  if (audio.bytes.byteLength > MAX_AUDIO) return Response.json({ error: "录音太长了。" }, { status: 400 });
  const db = getDb();
  const env = getEnv();
  const p = payload.data;
  try {
    const provider = getAIProvider(env);
    if (!provider?.voice.transcription) return Response.json({ error: "语音转写没有配置（需要 AI_TRANSCRIPTION_MODEL）。可以改用文字代替。", code: "not_configured" }, { status: 409, headers: noStore });
    const { profile } = await getLearnerSettings(db, g.user.id);
    const expected = expectedSpeech(p.promptId);
    const { value: transcript } = await runAI({ db, userId: g.user.id, task: "transcription", timeZone: profile.timezone, provider, env, unpriced: true }, async (ai) => {
      const r = await ai.transcribe({ audio: audio.bytes, mimeType: audio.type, expected });
      return { value: r.text.trim().slice(0, 4000), usage: r.usage, model: r.model };
    });
    // Silence in practice: ask again instead of storing an empty answer (in a mock test the attempt counts).
    if (!transcript && p.mode !== "mock") return Response.json({ silent: true }, { headers: noStore });
    const r = await submitAttempt(db, g.user.id, { ...p, response: { kind: "spoken", transcript, seconds: p.seconds, typed: false } }, provider, env);
    const mock = p.mockTestId ? await saveMockProgress(db, g.user.id, p.mockTestId, p.elapsedSeconds ?? 0) : null;
    return Response.json({ ok: true, data: { ...r, feedbackMessage: r.feedbackError ? (AI_ERROR_MESSAGES[r.feedbackError as AIErrorCode] ?? AI_ERROR_MESSAGES.unknown) : null, mock } }, { headers: noStore });
  } catch (error) {
    if (error instanceof AIError) return Response.json({ error: AI_ERROR_MESSAGES[error.code], code: error.code }, { status: error.code === "rate_limited" ? 429 : 400, headers: noStore });
    if (error instanceof PteRejectedError) return Response.json({ error: error.message }, { status: 400, headers: noStore });
    if (error instanceof PteNotFoundError) return Response.json({ error: "找不到这道题。" }, { status: 404, headers: noStore });
    throw error;
  }
}
