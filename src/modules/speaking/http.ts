import "server-only";

import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { InvalidAudioError } from "@/lib/storage";
import { AIError, AI_ERROR_MESSAGES } from "@/modules/ai/provider/errors";

import { SpeakingNotFoundError, SpeakingRejectedError } from "./services/speaking";

/** Shared checks for the Speaking Lab route handlers (audio and SDP bodies are too big for server actions). */

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return new Set([new URL(getEnv().APP_URL).origin, new URL(request.url).origin]).has(origin);
}

export async function guard(request: Request): Promise<{ user: CurrentUser } | { response: Response }> {
  const user = await getCurrentUser();
  if (!user) return { response: Response.json({ error: "请先登录。" }, { status: 401 }) };
  if (!sameOrigin(request)) return { response: Response.json({ error: "请求来源不正确。" }, { status: 403 }) };
  return { user };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** Learner-readable errors; never provider bodies or keys. */
export function errorResponse(error: unknown): Response {
  if (error instanceof AIError) {
    if (error.code !== "not_configured" && error.code !== "budget_exceeded") console.warn(`[speaking] ai failed: ${error.code}`);
    return Response.json({ error: AI_ERROR_MESSAGES[error.code], code: error.code }, { status: error.code === "rate_limited" ? 429 : 400, headers: noStore });
  }
  if (error instanceof SpeakingRejectedError) return Response.json({ error: error.message }, { status: 400, headers: noStore });
  if (error instanceof SpeakingNotFoundError) return Response.json({ error: "找不到这次口语练习。" }, { status: 404, headers: noStore });
  if (error instanceof InvalidAudioError) return Response.json({ error: "录音格式不支持（支持 webm / ogg / m4a / mp3 / wav）。" }, { status: 415, headers: noStore });
  throw error;
}

/** Read an uploaded audio part from multipart form data. */
export async function audioPart(form: FormData, name = "audio") {
  const file = form.get(name);
  if (!(file instanceof File) || file.size === 0) return null;
  return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type || "application/octet-stream" };
}
