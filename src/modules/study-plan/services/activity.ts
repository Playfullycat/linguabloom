import { sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/connection";
import { localDateString, startOfLocalDay, startOfLocalWeek } from "@/lib/time";

import type { Strand } from "../domain/session-templates";

/**
 * Study time from real records (spec §2.2, §5.1): lesson step durations,
 * review times, active time on reading / listening materials and Speaking Lab sessions, grouped into the Four Strands. Idle time is capped per
 * record so a tab left open doesn't count as study.
 */

const STEP_CAP_MS = 5 * 60_000;
const REVIEW_CAP_MS = 2 * 60_000;
const TIME_SLICE_CAP_MS = 60_000;
const SPEAKING_CAP_MS = 15 * 60_000;

export type WeeklyActivity = {
  /** Last 7 local days, oldest first. */
  days: { date: string; minutes: number }[];
  totalMinutes: number;
  byStrand: Record<Strand, number>;
  /** Distinct local days with any study since Monday. */
  activeDaysThisWeek: number;
  lastActivityAt: Date | null;
};

/**
 * One row per study record since `since`: when, how long (capped), which strand.
 * Shared by the weekly activity and the long-term trends so both count time the same way.
 */
export function studyRecords(userId: string, since: string) {
  return sql`
    select a.created_at as at,
           least(coalesce(a.duration_ms, 0), ${STEP_CAP_MS})::int as ms,
           case
             when s.skill in ('spoken_production','spoken_interaction','written_production','written_interaction')
               or s.role = 'communicative_task' then 'meaning_focused_output'
             when s.role = 'input' or s.skill in ('listening','reading') then 'meaning_focused_input'
             else 'language_focused_learning'
           end as strand
    from lesson_step_attempts a
    join lesson_steps s on s.lesson_id = a.lesson_id and s.step_key = a.step_key
    where a.user_id = ${userId} and a.created_at >= ${since}::timestamptz
    union all
    select reviewed_at, least(coalesce(elapsed_ms, 0), ${REVIEW_CAP_MS})::int, 'language_focused_learning'
    from review_logs
    where user_id = ${userId} and reviewed_at >= ${since}::timestamptz
    union all
    -- Active time on a reading or listening material (already capped per slice).
    select created_at, least(coalesce(duration_ms, 0), ${TIME_SLICE_CAP_MS})::int, 'meaning_focused_input'
    from content_interactions
    where user_id = ${userId} and kind = 'time' and created_at >= ${since}::timestamptz
    union all
    -- A finished Speaking Lab session (output practice).
    select ended_at, least(coalesce(duration_seconds, 0) * 1000, ${SPEAKING_CAP_MS})::int, 'meaning_focused_output'
    from speaking_attempts
    where user_id = ${userId} and status = 'ended' and ended_at >= ${since}::timestamptz
  `;
}

export async function getWeeklyActivity(db: DbExecutor, userId: string, now: Date, timeZone: string): Promise<WeeklyActivity> {
  const today = startOfLocalDay(now, timeZone);
  const from = startOfLocalDay(new Date(today.getTime() - 6 * 86_400_000 + 3_600_000), timeZone);
  const week = startOfLocalWeek(now, timeZone);
  const since = (from < week ? from : week).toISOString();

  const rows = await db.execute<{ at: string; ms: number; strand: Strand }>(studyRecords(userId, since));

  const [last] = await db.execute<{ last: string | null }>(sql`
    select greatest(
      (select max(reviewed_at) from review_logs where user_id = ${userId}),
      (select max(created_at) from lesson_step_attempts where user_id = ${userId}),
      (select max(created_at) from content_interactions where user_id = ${userId} and kind <> 'open'),
      (select max(ended_at) from speaking_attempts where user_id = ${userId})
    ) as last
  `);

  const dayKeys: string[] = [];
  for (let i = 6; i >= 0; i -= 1) dayKeys.push(localDateString(new Date(today.getTime() - i * 86_400_000 + 12 * 3_600_000), timeZone));
  const perDay = new Map(dayKeys.map((d) => [d, 0]));
  const byStrand: Record<Strand, number> = {
    meaning_focused_input: 0,
    meaning_focused_output: 0,
    language_focused_learning: 0,
    fluency_development: 0,
  };
  const activeThisWeek = new Set<string>();
  let total = 0;

  for (const row of rows) {
    const at = new Date(row.at);
    const key = localDateString(at, timeZone);
    if (at >= week) activeThisWeek.add(key);
    if (!perDay.has(key)) continue;
    const minutes = Number(row.ms) / 60_000;
    perDay.set(key, perDay.get(key)! + minutes);
    byStrand[row.strand] += minutes;
    total += minutes;
  }

  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    days: dayKeys.map((date) => ({ date, minutes: round(perDay.get(date)!) })),
    totalMinutes: round(total),
    byStrand: Object.fromEntries(Object.entries(byStrand).map(([k, v]) => [k, round(v)])) as Record<Strand, number>,
    activeDaysThisWeek: activeThisWeek.size,
    lastActivityAt: last?.last ? new Date(last.last) : null,
  };
}
