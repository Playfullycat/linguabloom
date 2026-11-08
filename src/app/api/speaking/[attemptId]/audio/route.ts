import { getDb } from "@/db";
import { audioPart, errorResponse, guard, noStore, UUID } from "@/modules/speaking/http";
import { attachSessionAudio } from "@/modules/speaking/services/speaking";

/** Realtime sessions: the learner's own microphone recording, uploaded at the end — only if they agreed to save audio. */
export async function POST(request: Request, ctx: RouteContext<"/api/speaking/[attemptId]/audio">) {
  const g = await guard(request);
  if ("response" in g) return g.response;
  const { attemptId } = await ctx.params;
  if (!UUID.test(attemptId)) return Response.json({ error: "找不到这次口语练习。" }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const audio = form ? await audioPart(form) : null;
  if (!audio) return Response.json({ error: "没有收到录音。" }, { status: 400 });
  try {
    const id = await attachSessionAudio(getDb(), g.user.id, attemptId, audio);
    return Response.json({ id }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
