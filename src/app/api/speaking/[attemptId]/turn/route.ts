import { z } from "zod";

import { getDb } from "@/db";
import { AI_ERROR_MESSAGES } from "@/modules/ai/provider/errors";
import { audioPart, errorResponse, guard, noStore, UUID } from "@/modules/speaking/http";
import { MAX_TURN_TEXT, speakingTurn } from "@/modules/speaking/services/speaking";

/**
 * Standard voice mode and typed answers: one learner turn (recording or
 * text) → transcript → the teacher's reply (text; speech is fetched
 * separately so the words appear first).
 */

const historySchema = z
  .array(z.object({ role: z.enum(["learner", "ai"]), text: z.string().max(MAX_TURN_TEXT * 2), item: z.number().int().min(0).max(20).optional() }))
  .max(60);

export async function POST(request: Request, ctx: RouteContext<"/api/speaking/[attemptId]/turn">) {
  const g = await guard(request);
  if ("response" in g) return g.response;
  const { attemptId } = await ctx.params;
  if (!UUID.test(attemptId)) return Response.json({ error: "找不到这次口语练习。" }, { status: 404 });
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "提交的内容格式不正确。" }, { status: 400 });

  let history: z.infer<typeof historySchema>;
  try {
    history = historySchema.parse(JSON.parse(String(form.get("history") ?? "[]")));
  } catch {
    return Response.json({ error: "提交的内容格式不正确。" }, { status: 400 });
  }
  const text = typeof form.get("text") === "string" ? String(form.get("text")).slice(0, MAX_TURN_TEXT) : undefined;
  const itemRaw = form.get("item");
  const item = typeof itemRaw === "string" && itemRaw !== "" ? Number(itemRaw) : undefined;

  try {
    const audio = await audioPart(form);
    const r = await speakingTurn(getDb(), g.user.id, attemptId, { audio: audio ?? undefined, text, item, history });
    return Response.json(
      {
        learnerText: r.learnerText,
        silent: r.silent,
        aiText: r.aiText,
        replyError: r.replyError ? AI_ERROR_MESSAGES[r.replyError.code] : null,
        comparison: r.comparison,
        final: r.final,
        saved: r.audioAssetId !== null,
      },
      { headers: noStore },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
