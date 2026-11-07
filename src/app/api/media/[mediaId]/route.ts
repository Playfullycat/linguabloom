import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveStored } from "@/lib/storage";
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

  const full = resolveStored(asset.storagePath);
  let size: number;
  try {
    size = (await stat(full)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const headers = new Headers({
    "Content-Type": asset.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });

  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, { status: 200, headers });
}
