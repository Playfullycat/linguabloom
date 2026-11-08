import "server-only";

import { getEnv, type Env } from "@/lib/config/env";

import { MockProvider } from "./mock";
import { OpenAIProvider } from "./openai";
import type { AIProvider, VoiceCapabilities } from "./types";

/**
 * Which AI is available right now, and why not if it isn't. The status is
 * safe to show in the UI: it never contains the key.
 */

export type AIStatus =
  | { available: true; provider: "openai" | "mock"; textModel: string; simulated: boolean; voice: VoiceCapabilities }
  | { available: false; reason: "disabled" | "missing_key" | "missing_model"; provider: string };

export function aiStatus(env: Env = getEnv()): AIStatus {
  if (!env.AI_ENABLED) return { available: false, reason: "disabled", provider: env.AI_PROVIDER };
  if (env.AI_PROVIDER === "mock") return { available: true, provider: "mock", textModel: "mock-tutor", simulated: true, voice: { realtime: true, transcription: true, speech: true } };
  if (!env.AI_API_KEY) return { available: false, reason: "missing_key", provider: env.AI_PROVIDER };
  if (!env.AI_TEXT_MODEL) return { available: false, reason: "missing_model", provider: env.AI_PROVIDER };
  return {
    available: true,
    provider: "openai",
    textModel: env.AI_TEXT_MODEL,
    simulated: false,
    voice: { realtime: Boolean(env.AI_REALTIME_MODEL), transcription: Boolean(env.AI_TRANSCRIPTION_MODEL), speech: Boolean(env.AI_TTS_MODEL) },
  };
}

let cached: { key: string; provider: AIProvider } | undefined;

/** The configured provider, or null when AI is unavailable (callers show the reason). */
export function getAIProvider(env: Env = getEnv()): AIProvider | null {
  const status = aiStatus(env);
  if (!status.available) return null;
  const key = [status.provider, status.textModel, env.AI_BASE_URL, env.AI_REALTIME_MODEL, env.AI_TRANSCRIPTION_MODEL, env.AI_TTS_MODEL].join("|");
  if (cached?.key === key) return cached.provider;
  const provider =
    status.provider === "mock"
      ? new MockProvider()
      : new OpenAIProvider({
          apiKey: env.AI_API_KEY!,
          baseUrl: env.AI_BASE_URL ?? "https://api.openai.com/v1",
          textModel: status.textModel,
          realtimeModel: env.AI_REALTIME_MODEL,
          transcriptionModel: env.AI_TRANSCRIPTION_MODEL,
          ttsModel: env.AI_TTS_MODEL,
          timeoutMs: env.AI_TIMEOUT_MS,
        });
  cached = { key, provider };
  return provider;
}

export const AI_STATUS_LABELS: Record<"disabled" | "missing_key" | "missing_model", string> = {
  disabled: "AI 未启用（AI_ENABLED=false）",
  missing_key: "已启用，但没有设置 AI_API_KEY",
  missing_model: "已启用，但没有设置 AI_TEXT_MODEL",
};
