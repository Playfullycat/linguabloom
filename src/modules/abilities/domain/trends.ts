/**
 * Pure helpers for the long-term learning trends (spec §5.15, Phase 5.3).
 */

/** Pearson correlation of paired values; null with fewer than `minPairs` pairs or no variation. */
export function pearson(pairs: [number, number][], minPairs = 4): number | null {
  if (pairs.length < minPairs) return null;
  const n = pairs.length;
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** How to describe a correlation honestly: direction, strength, and never as a cause. */
export function describeCorrelation(r: number | null): string {
  if (r === null) return "数据还不够（至少需要 4 周、每周 10 次以上成熟卡片的复习），暂时看不出关系。";
  const strength = Math.abs(r) >= 0.7 ? "较强" : Math.abs(r) >= 0.4 ? "中等" : "很弱";
  const direction = r > 0 ? "学习时间多的那几周，保留率往往也高" : "学习时间多的那几周，保留率反而偏低";
  if (strength === "很弱") return `相关系数 r = ${r.toFixed(2)}：两者几乎看不出关系。`;
  return `相关系数 r = ${r.toFixed(2)}（${strength}）：${direction}。这只是相关，不代表因果，周数少时结论也不稳定。`;
}

/** Index of the week a local date (YYYY-MM-DD) falls in, given the sorted week-start dates; -1 if before the first. */
export function weekIndex(weekStarts: string[], localDate: string): number {
  let index = -1;
  for (let i = 0; i < weekStarts.length; i += 1) if (localDate >= weekStarts[i]!) index = i;
  return index;
}
