import { normalizeAnswer } from "../../curriculum/domain/scoring";
import type { CefrLevel } from "../../curriculum/domain/cefr";
import type { AssessmentItemContent, DiagnosticSkill } from "../content";

/**
 * Placement diagnostic (spec §4.2): tiered and adaptive so beginners don't
 * face a run of hard items, short enough to finish in one sitting, and honest
 * about uncertainty — the result is always a "preliminary estimate".
 */

/** Levels covered by the placement bank. */
export const PLACEMENT_LEVELS = ["pre_a1", "a1", "a2", "b1"] as const satisfies readonly CefrLevel[];
export type PlacementLevel = (typeof PLACEMENT_LEVELS)[number];

export const MAX_ITEMS: Record<DiagnosticSkill, number> = {
  vocabulary: 6,
  grammar: 6,
  reading: 4,
  listening: 4,
};

export const SELF_REPORTED_LEVELS = ["beginner", "forgot", "read_simple", "daily_conversation"] as const;
export type SelfReportedLevel = (typeof SELF_REPORTED_LEVELS)[number];

export const SELF_REPORT_LABELS: Record<SelfReportedLevel, string> = {
  beginner: "完全入门：几乎没学过",
  forgot: "学过，但忘得差不多了",
  read_simple: "能读懂简单的内容",
  daily_conversation: "能进行日常交流",
};

/** Where the staircase starts. Self-report only picks the first item, it never sets the level. */
export function startLevel(selfReport: string | null | undefined): PlacementLevel {
  switch (selfReport) {
    case "beginner":
      return "pre_a1";
    case "read_simple":
    case "daily_conversation":
      return "a2";
    default:
      return "a1";
  }
}

export type AttemptLike = { itemId: string; level: string; isCorrect: boolean };
export type ItemLike = { id: string; level: string; difficulty: number };

const levelIndex = (level: string) => Math.max(0, PLACEMENT_LEVELS.indexOf(level as PlacementLevel));

/**
 * Next item for one skill: up one level after a correct answer, down one
 * after a wrong one. Returns null when the skill is finished.
 */
/**
 * `avoid`: items used in the learner's previous diagnostic. They are only
 * chosen when nothing else is left at a suitable level, so a retake isn't the
 * same test again.
 */
export function nextItem<T extends ItemLike>(skill: DiagnosticSkill, attempts: AttemptLike[], items: T[], start: PlacementLevel, avoid: ReadonlySet<string> = new Set()): T | null {
  if (attempts.length >= MAX_ITEMS[skill]) return null;
  const seen = new Set(attempts.map((a) => a.itemId));
  const unseen = items.filter((i) => !seen.has(i.id));
  if (unseen.length === 0) return null;

  const last = attempts.at(-1);
  let target = levelIndex(start);
  if (last) target = Math.min(PLACEMENT_LEVELS.length - 1, Math.max(0, levelIndex(last.level) + (last.isCorrect ? 1 : -1)));

  // Closest available level to the target; ties prefer the direction of travel.
  const direction = last ? (last.isCorrect ? 1 : -1) : 1;
  const ranked = [...unseen].sort((a, b) => {
    const da = Math.abs(levelIndex(a.level) - target);
    const db = Math.abs(levelIndex(b.level) - target);
    if (da !== db) return da - db;
    const aa = avoid.has(a.id) ? 1 : 0;
    const ab = avoid.has(b.id) ? 1 : 0;
    if (aa !== ab) return aa - ab;
    const sa = Math.sign(levelIndex(a.level) - target) === direction ? 0 : 1;
    const sb = Math.sign(levelIndex(b.level) - target) === direction ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return a.difficulty - b.difficulty || a.id.localeCompare(b.id);
  });
  return ranked[0] ?? null;
}

export type SkillEstimate = {
  level: PlacementLevel;
  /** Never "high" from a short placement test. */
  confidence: "low" | "medium";
  evidenceCount: number;
  correct: number;
  /** The learner answered the top items correctly: the real level may be higher. */
  mayBeHigher: boolean;
  byLevel: Record<string, { correct: number; total: number }>;
};

/**
 * Highest level with at least half of its items correct (and at least one).
 * Below that, the learner is placed at Pre-A1.
 */
export function estimateSkill(attempts: AttemptLike[]): SkillEstimate | null {
  if (attempts.length === 0) return null;
  const byLevel: Record<string, { correct: number; total: number }> = {};
  for (const a of attempts) {
    const bucket = (byLevel[a.level] ??= { correct: 0, total: 0 });
    bucket.total += 1;
    if (a.isCorrect) bucket.correct += 1;
  }
  let level: PlacementLevel = "pre_a1";
  for (const candidate of PLACEMENT_LEVELS) {
    const b = byLevel[candidate];
    if (b && b.correct >= 1 && b.correct / b.total >= 0.5) level = candidate;
  }
  const correct = attempts.filter((a) => a.isCorrect).length;
  const top = byLevel.b1;
  return {
    level,
    confidence: attempts.length >= 6 ? "medium" : "low",
    evidenceCount: attempts.length,
    correct,
    mayBeHigher: level === "b1" && Boolean(top && top.correct === top.total),
    byLevel,
  };
}

/** Check an answer against the item's key (server side only). */
export function scoreItem(item: AssessmentItemContent, response: { choice?: number; text?: string }): boolean {
  if (item.type === "choice") return response.choice === item.answer;
  const given = normalizeAnswer(response.text ?? "");
  return given.length > 0 && item.answers.some((a) => normalizeAnswer(a) === given);
}

/** Item as sent to the browser: no answer key. */
export function toClientItem(item: AssessmentItemContent) {
  if (item.type === "choice") {
    const { answer: _a, explanation_zh: _e, ...rest } = item;
    void _a;
    void _e;
    return rest;
  }
  const { answers: _a, explanation_zh: _e, ...rest } = item;
  void _a;
  void _e;
  return rest;
}
export type ClientAssessmentItem = ReturnType<typeof toClientItem>;
