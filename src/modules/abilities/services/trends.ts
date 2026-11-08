import { sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/connection";
import { localDateString, startOfLocalDay, startOfLocalWeek } from "@/lib/time";
import { ERROR_CATEGORY_LABELS } from "@/modules/grammar/content";
import { SKILLS, type Skill } from "@/modules/curriculum/content/schema";
import { studyRecords } from "@/modules/study-plan/services/activity";

import { SKILL_LABELS } from "../content";
import { pearson, weekIndex } from "../domain/trends";
import { syncCanDoEvidence } from "./abilities";

/**
 * Long-term learning trends (spec §5.15, Phase 5.3), week by week: study time
 * next to retention, new passing can-do evidence per skill, and errors per
 * category. Everything comes from real records; the study-time / retention
 * relationship is reported as a correlation, never as a cause.
 */

export const TREND_WEEKS = 8;
/** A week's retention is only shown with at least this many reviews of mature cards. */
export const MIN_MATURE_REVIEWS = 10;

export type TrendWeek = { start: string; minutes: number; matureReviews: number; retention: number | null };
export type TrendRow = { key: string; label: string; perWeek: number[]; total: number };
export type LearningTrends = { weeks: TrendWeek[]; evidence: TrendRow[]; errors: TrendRow[]; correlation: number | null };

export async function getLearningTrends(db: DbExecutor, userId: string, now: Date, timeZone: string, weeks = TREND_WEEKS): Promise<LearningTrends> {
  // Week starts (local Mondays), oldest first.
  const thisWeek = startOfLocalWeek(now, timeZone);
  const starts: Date[] = [thisWeek];
  for (let i = 1; i < weeks; i += 1) starts.unshift(startOfLocalWeek(startOfLocalDay(new Date(starts[0]!.getTime() - 3_600_000), timeZone), timeZone));
  const keys = starts.map((d) => localDateString(new Date(d.getTime() + 12 * 3_600_000), timeZone));
  const since = starts[0]!.toISOString();
  const bucket = (at: string | Date) => weekIndex(keys, localDateString(new Date(at), timeZone));

  const minutes = keys.map(() => 0);
  for (const r of await db.execute<{ at: string; ms: number }>(studyRecords(userId, since))) {
    const i = bucket(r.at);
    if (i >= 0) minutes[i]! += Number(r.ms) / 60_000;
  }

  // Retention: reviews of cards already in the "review" state, rated Hard or better (same rule as the progress page).
  const reviews = keys.map(() => ({ n: 0, kept: 0 }));
  for (const r of await db.execute<{ at: string; rating: number }>(sql`
    select reviewed_at as at, rating from review_logs
    where user_id = ${userId} and reviewed_at >= ${since}::timestamptz and (state_before->>'state')::int = 2
  `)) {
    const i = bucket(r.at);
    if (i < 0) continue;
    reviews[i]!.n += 1;
    if (Number(r.rating) > 1) reviews[i]!.kept += 1;
  }

  await syncCanDoEvidence(db, userId, timeZone);
  const evidence = new Map<Skill, number[]>(SKILLS.map((s) => [s, keys.map(() => 0)]));
  for (const r of await db.execute<{ at: string; skill: Skill }>(sql`
    select e.occurred_at as at, s.skill from can_do_evidence e join can_do_statements s on s.id = e.can_do_id
    where e.user_id = ${userId} and e.outcome = 'pass' and e.occurred_at >= ${since}::timestamptz
  `)) {
    const i = bucket(r.at);
    if (i >= 0 && evidence.has(r.skill)) evidence.get(r.skill)![i]! += 1;
  }

  const errors = new Map<string, number[]>();
  for (const r of await db.execute<{ at: string; category: string }>(sql`
    select o.created_at as at, i.category from error_occurrences o join error_items i on i.id = o.error_item_id
    where o.user_id = ${userId} and o.created_at >= ${since}::timestamptz
  `)) {
    const i = bucket(r.at);
    if (i < 0) continue;
    if (!errors.has(r.category)) errors.set(r.category, keys.map(() => 0));
    errors.get(r.category)![i]! += 1;
  }

  const round = (n: number) => Math.round(n * 10) / 10;
  const trendWeeks: TrendWeek[] = keys.map((start, i) => ({
    start,
    minutes: round(minutes[i]!),
    matureReviews: reviews[i]!.n,
    retention: reviews[i]!.n >= MIN_MATURE_REVIEWS ? reviews[i]!.kept / reviews[i]!.n : null,
  }));
  const toRows = (map: Map<string, number[]>, label: (k: string) => string) =>
    [...map]
      .map(([key, perWeek]) => ({ key, label: label(key), perWeek, total: perWeek.reduce((s, n) => s + n, 0) }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);

  return {
    weeks: trendWeeks,
    evidence: toRows(evidence, (k) => SKILL_LABELS[k as Skill] ?? k),
    errors: toRows(errors, (k) => ERROR_CATEGORY_LABELS[k as keyof typeof ERROR_CATEGORY_LABELS] ?? k),
    correlation: pearson(trendWeeks.filter((w) => w.retention !== null).map((w) => [w.minutes, w.retention!])),
  };
}
