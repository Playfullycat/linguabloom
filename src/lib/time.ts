/**
 * Time helpers. Everything is stored in UTC; "today" is the learner's local
 * day in their timezone (spec §7.5).
 */

/** UTC instant at which the local day containing `now` starts in `timeZone`. */
export function startOfLocalDay(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsedMs = ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000 + now.getUTCMilliseconds();
  return new Date(now.getTime() - elapsedMs);
}

/** Short Chinese description of how far away a moment is ("10 分钟后", "3 天后"). */
export function describeDueIn(due: Date, now: Date): string {
  const minutes = Math.round((due.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return "现在";
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时后`;
  const days = Math.round(hours / 24);
  if (days < 45) return `${days} 天后`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} 个月后`;
  return `${Math.round(days / 365)} 年后`;
}

/** The learner's local calendar date for `now`, as "YYYY-MM-DD". */
export function localDateString(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** UTC instant at which the local week (Monday 00:00) containing `now` starts. */
export function startOfLocalWeek(now: Date, timeZone: string): Date {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
  const offset = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
  let start = startOfLocalDay(now, timeZone);
  // Step back one local day at a time (safe across DST changes).
  for (let i = 0; i < offset; i += 1) start = startOfLocalDay(new Date(start.getTime() - 3_600_000), timeZone);
  return start;
}
