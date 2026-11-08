import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { csvResponse, toCsv } from "@/lib/csv";
import { getLearningTrends } from "@/modules/abilities/services/trends";
import { getLearnerSettings } from "@/modules/learner/services/profile";

/** Export the weekly learning trends (Phase 5.3): one row per measure, one column per week. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const db = getDb();
  const { profile } = await getLearnerSettings(db, user.id, getEnv().DEFAULT_TIMEZONE);
  const trends = await getLearningTrends(db, user.id, new Date(), profile.timezone);

  const weeks = trends.weeks.map((w) => w.start);
  const rows: unknown[][] = [
    ["study_minutes", "", ...trends.weeks.map((w) => w.minutes)],
    ["mature_reviews", "", ...trends.weeks.map((w) => w.matureReviews)],
    ["retention", "", ...trends.weeks.map((w) => (w.retention === null ? "" : w.retention.toFixed(3)))],
    ...trends.evidence.map((r) => ["evidence_pass", r.key, ...r.perWeek]),
    ...trends.errors.map((r) => ["errors", r.key, ...r.perWeek]),
  ];
  const csv = toCsv(["measure", "key", ...weeks.map((w) => `week_of_${w}`)], rows);
  return csvResponse(`linguabloom-trends-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
