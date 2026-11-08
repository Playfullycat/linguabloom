import "server-only";

import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DbExecutor } from "@/db/connection";
import { getEnv, type Env } from "@/lib/config/env";
import { resolveStored } from "@/lib/storage";
import { getAIProvider } from "@/modules/ai/provider";
import { AIError } from "@/modules/ai/provider/errors";
import type { AIProvider } from "@/modules/ai/provider/types";
import { runAI } from "@/modules/ai/services/usage";
import { getLearnerSettings } from "@/modules/learner/services/profile";

/**
 * Generated speech, made once and kept as a file under STORAGE_ROOT/tts (so it
 * is part of backups and is never paid for twice). The file name is a hash of
 * provider, model, voice, speed and text: changing any of them makes a new file.
 *
 * Used for PTE listening prompts, built-in listening materials and the Speaking
 * Lab teacher. Without a speech model the callers fall back to browser speech.
 */

export const MAX_TTS_CHARS = 2400;

export type CachedSpeech = { relativePath: string; mimeType: string; generated: boolean };

const EXT: Record<string, string> = { "audio/mpeg": "mp3", "audio/wav": "wav" };

export function speechAvailable(env: Env = getEnv(), provider?: AIProvider | null) {
  const p = provider === undefined ? getAIProvider(env) : provider;
  return Boolean(p?.voice.speech);
}

function keyFor(p: AIProvider, env: Env, text: string, slow: boolean) {
  return createHash("sha256").update([p.name, env.AI_TTS_MODEL ?? "", env.AI_VOICE, slow ? "slow" : "normal", text].join("\u0000")).digest("hex").slice(0, 32);
}

async function exists(relative: string) {
  try {
    await access(resolveStored(relative));
    return true;
  } catch {
    return false;
  }
}

export async function cachedSpeech(db: DbExecutor, userId: string, text: string, opts: { slow?: boolean } = {}, provider?: AIProvider | null, env: Env = getEnv()): Promise<CachedSpeech> {
  const clean = text.replace(/（模拟）/g, "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > MAX_TTS_CHARS) throw new AIError("invalid_response", "speech text empty or too long");
  const p = provider === undefined ? getAIProvider(env) : provider;
  if (!p) throw new AIError("not_configured");
  if (!p.voice.speech) throw new AIError("not_configured", "no speech model");
  const key = keyFor(p, env, clean, Boolean(opts.slow));
  for (const [mime, ext] of Object.entries(EXT)) {
    const rel = path.posix.join("tts", `${key}.${ext}`);
    if (await exists(rel)) return { relativePath: rel, mimeType: mime, generated: false };
  }
  const { profile } = await getLearnerSettings(db, userId);
  const { value } = await runAI({ db, userId, task: "speech", timeZone: profile.timezone, provider: p, env, unpriced: true }, async (ai) => {
    const r = await ai.synthesizeSpeech({ text: clean, voice: env.AI_VOICE, slow: Boolean(opts.slow) });
    return { value: r, usage: r.usage, model: r.model };
  });
  const ext = EXT[value.mimeType] ?? "mp3";
  const rel = path.posix.join("tts", `${key}.${ext}`);
  const full = resolveStored(rel);
  await mkdir(path.dirname(full), { recursive: true });
  try {
    await writeFile(full, value.audio, { flag: "wx" });
  } catch (error) {
    // Another request wrote the same file first: fine.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return { relativePath: rel, mimeType: value.mimeType, generated: true };
}
