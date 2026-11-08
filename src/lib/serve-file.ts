import "server-only";

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { resolveStored } from "@/lib/storage";

/**
 * Stream a stored file with HTTP Range support (so audio players can seek).
 * Returns 404 when the file is missing.
 */
export async function serveStoredFile(request: Request, relativePath: string, mimeType: string, cacheControl = "private, max-age=3600"): Promise<Response> {
  const full = resolveStored(relativePath);
  let size: number;
  try {
    size = (await stat(full)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const headers = new Headers({ "Content-Type": mimeType, "Accept-Ranges": "bytes", "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff" });
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, { status: 200, headers });
}
