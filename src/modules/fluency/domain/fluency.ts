import { CEFR_LEVELS, type CefrLevel } from "@/modules/curriculum/domain/cefr";
import { words } from "@/modules/materials/domain/text";

/**
 * Fluency development (spec §2.2, Nation's Four Strands): doing what you
 * already know, faster and more smoothly. Three activities on a text the
 * learner has already read (or one below their level):
 *
 * - speed reading: read once at a push, then answer the questions without the text;
 * - repeated reading: read the same text aloud three times, each a little smoother;
 * - timed retelling (4/3/2): tell the same content three times in less and less time.
 *
 * No correction and no AI: fluency practice is about speed and ease, not accuracy.
 */

export const FLUENCY_KINDS = ["speed_reading", "repeated_reading", "timed_retell"] as const;
export type FluencyKind = (typeof FLUENCY_KINDS)[number];

export function isFluencyKind(value: unknown): value is FluencyKind {
  return typeof value === "string" && (FLUENCY_KINDS as readonly string[]).includes(value);
}

export const FLUENCY_KIND_LABELS: Record<FluencyKind, { zh: string; en: string; summary: string; steps: string[] }> = {
  speed_reading: {
    zh: "快速阅读",
    en: "Speed reading",
    summary: "用比平时稍快的速度默读一篇读过的短文，读完后不看原文回答几道理解题。",
    steps: ["点“开始”后计时，读完点“读完了”", "不要回头重读，遇到不确定的词直接往下读", "原文收起后回答理解题，答对 70% 以上这次速度才算数"],
  },
  repeated_reading: {
    zh: "重复朗读",
    en: "Repeated reading",
    summary: "把同一篇短文大声读三遍，每一遍都争取读得更顺、更快一点。",
    steps: ["每一遍点“开始”后朗读，读完点“读完了”", "读错了不用停下来改，接着往下读", "三遍读完看看速度的变化"],
  },
  timed_retell: {
    zh: "限时复述（4/3/2）",
    en: "Timed retelling",
    summary: "先读一遍短文，然后不看原文把内容讲三遍，每一遍的时间更短。",
    steps: ["先读原文，准备好了再开始", "原文收起后看着提示词讲，时间到就停", "第二、三遍时间更短，试着讲出同样多的内容"],
  },
};

/** Rounds per activity. */
export const ROUNDS: Record<FluencyKind, number> = { speed_reading: 1, repeated_reading: 3, timed_retell: 3 };

/**
 * Time limits for the three retelling rounds. Nation's 4/3/2 (minutes) is for
 * long talks; these short texts get the same shrinking shape in seconds.
 */
export function retellLimitsMs(level: string): [number, number, number] {
  const i = Math.max(0, CEFR_LEVELS.indexOf(level as CefrLevel));
  if (i <= 1) return [60_000, 45_000, 30_000]; // Pre-A1, A1
  if (i <= 3) return [90_000, 60_000, 45_000]; // A2, B1
  return [120_000, 90_000, 60_000]; // B2+
}

/** A round finished faster than this was almost certainly not a real reading. */
export const MAX_WPM: Record<Exclude<FluencyKind, "timed_retell">, number> = { speed_reading: 1000, repeated_reading: 400 };
export const MIN_ROUND_MS = 3_000;
export const MAX_ROUND_MS = 15 * 60_000;
/** Total time counted as study time for one activity. */
export const MAX_DURATION_MS = 20 * 60_000;
/** Speed reading counts only when at least this share of the questions was right (Nation: about 70%). */
export const COMPREHENSION_PASS = 0.7;

export function wordsPerMinute(wordCount: number, ms: number): number {
  return Math.round((wordCount / ms) * 60_000);
}

export function wordCountOf(segments: string[]): number {
  return segments.reduce((n, s) => n + words(s).length, 0);
}

/** Whether a speed-reading result counts toward the learner's reading speed. */
export function speedCounts(correct: number | null, total: number | null): boolean {
  if (correct === null || !total) return true;
  return correct / total >= COMPREHENSION_PASS;
}

/**
 * Prompt words for retelling: the glossary words in the order they appear,
 * else the longest words of the text (for imported texts without a glossary).
 */
export function retellCues(segments: string[], glossary: { text: string }[], max = 8): string[] {
  const text = segments.join(" ").toLowerCase();
  const fromGlossary = glossary
    .map((g) => ({ word: g.text, at: text.indexOf(g.text.toLowerCase()) }))
    .filter((g) => g.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((g) => g.word);
  if (fromGlossary.length >= 3) return [...new Set(fromGlossary)].slice(0, max);
  // Longest distinct words, shown in the order they come in the text.
  const unique: string[] = [];
  for (const w of words(segments.join(" "))) {
    if (w.length >= 6 && !unique.some((u) => u.toLowerCase() === w.toLowerCase())) unique.push(w);
  }
  const longest = new Set([...unique].sort((a, b) => b.length - a.length).slice(0, max));
  return [...new Set([...fromGlossary, ...unique.filter((w) => longest.has(w))])].slice(0, max);
}

/** Weekly fluency minutes the plan aims for: more at higher levels (spec §2.2). */
export function weeklyFluencyTarget(level: string | null): number {
  const i = level ? CEFR_LEVELS.indexOf(level as CefrLevel) : 0;
  if (i <= 1) return 10;
  if (i <= 3) return 15;
  return 20;
}

/**
 * Which activity to suggest: the one done least in the recent past. Beginners
 * start with reading aloud; speed reading on a 40-word text says little.
 */
export function suggestKind(level: string | null, recentCounts: Partial<Record<FluencyKind, number>>): FluencyKind {
  const i = level ? CEFR_LEVELS.indexOf(level as CefrLevel) : 0;
  const order: FluencyKind[] = i <= 1 ? ["repeated_reading", "timed_retell", "speed_reading"] : ["speed_reading", "repeated_reading", "timed_retell"];
  return [...order].sort((a, b) => (recentCounts[a] ?? 0) - (recentCounts[b] ?? 0))[0]!;
}

/** Change between the first and the last round, as a whole percentage (positive = faster). */
export function roundGain(rounds: { ms: number }[]): number | null {
  if (rounds.length < 2) return null;
  const first = rounds[0]!.ms;
  const last = rounds.at(-1)!.ms;
  return Math.round(((first - last) / first) * 100);
}
