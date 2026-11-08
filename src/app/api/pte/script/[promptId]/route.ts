import { getCurrentUser } from "@/lib/auth/session";
import { PteNotFoundError, getAudioScript } from "@/modules/pte/services/pte";

/** The listening script, fetched only when the browser must read it aloud itself (no speech model). */
export async function GET(_request: Request, ctx: RouteContext<"/api/pte/script/[promptId]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { promptId } = await ctx.params;
  try {
    return Response.json({ text: getAudioScript(promptId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PteNotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
