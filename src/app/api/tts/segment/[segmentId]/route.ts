import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { serveStoredFile } from "@/lib/serve-file";
import { AIError, AI_ERROR_MESSAGES } from "@/modules/ai/provider/errors";
import { cachedSpeech, speechAvailable } from "@/modules/audio/tts-cache";
import { getSegmentText } from "@/modules/materials/services/materials";

/**
 * One sentence of a listening material as generated speech (cached as a file).
 * `?slow=1` asks for a slower reading. Without a speech model: 409, and the
 * listening studio keeps using the browser's voice.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/tts/segment/[segmentId]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { segmentId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(segmentId)) return new Response("Not found", { status: 404 });
  const db = getDb();
  const text = await getSegmentText(db, user.id, segmentId);
  if (!text) return new Response("Not found", { status: 404 });
  if (!speechAvailable()) return Response.json({ fallback: "browser" }, { status: 409 });
  try {
    const speech = await cachedSpeech(db, user.id, text, { slow: new URL(request.url).searchParams.get("slow") === "1" });
    return serveStoredFile(request, speech.relativePath, speech.mimeType, "private, max-age=86400");
  } catch (error) {
    if (error instanceof AIError) return Response.json({ fallback: "browser", error: AI_ERROR_MESSAGES[error.code] }, { status: 409 });
    throw error;
  }
}
