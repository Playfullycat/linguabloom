import { z } from "zod";

import { getDb } from "@/db";
import { serveStoredFile } from "@/lib/serve-file";
import { errorResponse, guard } from "@/modules/speaking/http";
import { MAX_SPEECH_TEXT, synthesize } from "@/modules/speaking/services/speaking";

/** The teacher's line (or a sentence to repeat) as speech, generated once by the provider's TTS model and cached as a file. */
const bodySchema = z.object({ text: z.string().min(1).max(MAX_SPEECH_TEXT * 2), slow: z.boolean().default(false) });

export async function POST(request: Request) {
  const g = await guard(request);
  if ("response" in g) return g.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "要朗读的文字格式不正确。" }, { status: 400 });
  try {
    const speech = await synthesize(getDb(), g.user.id, parsed.data.text, parsed.data.slow);
    return serveStoredFile(request, speech.relativePath, speech.mimeType, "private, no-store");
  } catch (error) {
    return errorResponse(error);
  }
}
