import { getDb } from "@/db";
import { errorResponse, guard, noStore, UUID } from "@/modules/speaking/http";
import { connectRealtime } from "@/modules/speaking/services/speaking";

/**
 * Realtime voice (spec §7.7): the browser posts its WebRTC SDP offer, the
 * server mints a short-lived single-use provider credential, exchanges SDP
 * with it and returns only the answer. No key — long-term or ephemeral —
 * ever reaches the browser. Rate limited per learner and per session.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/speaking/[attemptId]/connect">) {
  const g = await guard(request);
  if ("response" in g) return g.response;
  const { attemptId } = await ctx.params;
  if (!UUID.test(attemptId)) return Response.json({ error: "找不到这次口语练习。" }, { status: 404 });
  const offer = await request.text();
  try {
    const { answerSdp } = await connectRealtime(getDb(), g.user.id, attemptId, offer);
    return new Response(answerSdp, { headers: { "Content-Type": "application/sdp", ...noStore } });
  } catch (error) {
    return errorResponse(error);
  }
}
