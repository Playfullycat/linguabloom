import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { AIError, AI_ERROR_MESSAGES } from "@/modules/ai/provider/errors";
import { TutorSessionNotFoundError, tutorStream } from "@/modules/ai/services/tutor";
import type { RoleplayScene } from "@/modules/ai/tutor/prompts";
import { tutorRequestSchema } from "@/modules/ai/tutor/request";

/**
 * Streamed tutor replies (conversation, roleplay) as newline-delimited JSON:
 *   {"t":"meta",...} {"t":"delta","text":"…"}… {"t":"done","sessionId":…} | {"t":"error",…}
 * The provider key never leaves the server.
 */

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return new Set([new URL(getEnv().APP_URL).origin, new URL(request.url).origin]).has(origin);
}

const line = (o: unknown) => new TextEncoder().encode(`${JSON.stringify(o)}\n`);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "请求来源不正确。" }, { status: 403 });
  const parsed = tutorRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "提交的内容格式不正确。" }, { status: 400 });

  let stream: Awaited<ReturnType<typeof tutorStream>>;
  try {
    stream = await tutorStream(getDb(), user.id, { ...parsed.data, scene: parsed.data.scene as RoleplayScene | undefined }, request.signal);
  } catch (error) {
    if (error instanceof AIError) return Response.json({ error: AI_ERROR_MESSAGES[error.code], code: error.code }, { status: 400 });
    if (error instanceof TutorSessionNotFoundError) return Response.json({ error: "找不到这段对话。" }, { status: 404 });
    throw error;
  }

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(line({ t: "meta", level: stream.level, levelBasis: stream.levelBasis }));
      try {
        for await (const text of stream.deltas) controller.enqueue(line({ t: "delta", text }));
        controller.enqueue(line({ t: "done", sessionId: await stream.session }));
      } catch (error) {
        const code = error instanceof AIError ? error.code : "unknown";
        if (code !== "not_configured" && code !== "budget_exceeded") console.warn(`[ai] stream failed: ${code}`);
        controller.enqueue(line({ t: "error", code, error: AI_ERROR_MESSAGES[code as keyof typeof AI_ERROR_MESSAGES] ?? AI_ERROR_MESSAGES.unknown }));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
