import { z } from "zod";

import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { applyOfflineAnswers } from "@/modules/review/services/offline";

/**
 * Upload answers given while offline (Phase 5.3). Each answer carries its own
 * request id and the time it was given; repeats are ignored, so the browser
 * may retry freely. Answers recorded under another account are refused (409).
 */

const MAX_ANSWERS = 500;

const body = z.object({
  answers: z
    .array(
      z.object({
        userId: z.uuid(),
        cardId: z.uuid(),
        rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
        clientRequestId: z.uuid(),
        reviewedAt: z.iso.datetime({ offset: true }),
        elapsedMs: z.number().int().min(0).max(3_600_000).optional(),
        typed: z.string().max(200).optional(),
      }),
    )
    .max(MAX_ANSWERS),
});

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers may omit it; cookies are SameSite=Lax anyway
  const allowed = new Set([new URL(getEnv().APP_URL).origin, new URL(request.url).origin]);
  return allowed.has(origin);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "请先登录。" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ ok: false, error: "请求来源不正确。" }, { status: 403 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "离线复习记录的格式不正确。" }, { status: 400 });
  const { answers } = parsed.data;
  if (answers.some((a) => a.userId !== user.id)) {
    return Response.json({ ok: false, error: "这些离线复习记录属于另一个账号。" }, { status: 409 });
  }

  const results = await applyOfflineAnswers(getDb(), user.id, answers);
  return Response.json({ ok: true, results }, { headers: { "Cache-Control": "no-store" } });
}
