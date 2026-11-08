import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { serveStoredFile } from "@/lib/serve-file";
import { AIError, AI_ERROR_MESSAGES } from "@/modules/ai/provider/errors";
import { cachedSpeech, speechAvailable } from "@/modules/audio/tts-cache";
import { PteNotFoundError, getAudioScript } from "@/modules/pte/services/pte";

/**
 * Audio for a PTE listening prompt: generated once with the configured speech
 * model and cached as a file. Without a speech model: 409, and the page reads
 * the script with the browser's own voice (and says so).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/pte/audio/[promptId]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { promptId } = await ctx.params;
  let script: string;
  try {
    script = getAudioScript(promptId);
  } catch (error) {
    if (error instanceof PteNotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
  if (!speechAvailable()) return Response.json({ fallback: "browser" }, { status: 409 });
  try {
    const speech = await cachedSpeech(getDb(), user.id, script);
    return serveStoredFile(request, speech.relativePath, speech.mimeType, "private, max-age=86400");
  } catch (error) {
    if (error instanceof AIError) return Response.json({ fallback: "browser", error: AI_ERROR_MESSAGES[error.code] }, { status: 409 });
    throw error;
  }
}
