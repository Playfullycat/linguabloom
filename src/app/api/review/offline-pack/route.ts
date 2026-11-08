import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { getReviewQueue } from "@/modules/review/services/review";

/**
 * Today's review queue for offline use (Phase 5.3): the same cards the review
 * page would show right now. The browser keeps them so reviews can continue
 * without a connection; nothing is cached by intermediaries.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "请先登录。" }, { status: 401 });
  const db = getDb();
  const { profile, preferences } = await getLearnerSettings(db, user.id, getEnv().DEFAULT_TIMEZONE);
  const { cards } = await getReviewQueue(db, user.id, new Date(), profile.timezone, preferences.newItemsLimit);
  return Response.json({ userId: user.id, generatedAt: new Date().toISOString(), cards }, { headers: { "Cache-Control": "no-store" } });
}
