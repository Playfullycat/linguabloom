import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { serveStoredFile } from "@/lib/serve-file";
import { getOwnedMedia } from "@/modules/imports/services/imports";

/**
 * The learner's uploaded audio, only for its owner. Supports HTTP Range so
 * the player can seek (sentence playback, A-B loop) without downloading it all.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/media/[mediaId]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { mediaId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) return new Response("Not found", { status: 404 });
  const asset = await getOwnedMedia(getDb(), user.id, mediaId);
  if (!asset) return new Response("Not found", { status: 404 });
  return serveStoredFile(request, asset.storagePath, asset.mimeType);
}
