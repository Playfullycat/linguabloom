import type { LessonStepContent } from "../content/schema";

/**
 * The browser-facing version of a step: everything needed to render it, but
 * no answer keys. Shuffles are deterministic (seeded by the step id) so the
 * server render and the client hydrate to the same order.
 */
export type ClientStep =
  | Extract<LessonStepContent, { type: "orientation" | "dialogue" | "vocab" | "notice" | "teach" | "speak" | "write" }>
  | (Omit<Extract<LessonStepContent, { type: "choice" }>, "answer" | "explanation_zh">)
  | (Omit<Extract<LessonStepContent, { type: "cloze" }>, "answers" | "explanation_zh">)
  | (Omit<Extract<LessonStepContent, { type: "order" }>, "answers" | "explanation_zh" | "tokens"> & { tokens: string[] })
  | {
      id: string;
      type: "match";
      role: LessonStepContent["role"];
      skill: LessonStepContent["skill"];
      instructions_zh: string;
      lefts: string[];
      rights: string[];
    };

/** Small deterministic PRNG (mulberry32) seeded from a string. */
function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic shuffle that never returns the original order (when possible). */
export function deterministicShuffle<T>(items: readonly T[], seed: string): T[] {
  const result = [...items];
  if (result.length < 2) return result;
  const random = seededRandom(seed);
  for (let attempt = 0; attempt < 5; attempt++) {
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    if (result.some((item, i) => item !== items[i])) return result;
  }
  return [...result.slice(1), result[0]!];
}

/** Copy of `obj` without `keys` (used to strip answer keys). */
function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const copy = { ...obj };
  for (const key of keys) delete copy[key];
  return copy;
}

export function toClientStep(step: LessonStepContent, seed: string): ClientStep {
  switch (step.type) {
    case "choice":
      return omit(step, ["answer", "explanation_zh"]);
    case "cloze":
      return omit(step, ["answers", "explanation_zh"]);
    case "order":
      return { ...omit(step, ["answers", "explanation_zh"]), tokens: deterministicShuffle(step.tokens, `${seed}:tokens`) };
    case "match":
      return {
        id: step.id,
        type: "match",
        role: step.role,
        skill: step.skill,
        instructions_zh: step.instructions_zh,
        lefts: step.pairs.map((p) => p.left),
        rights: deterministicShuffle(
          step.pairs.map((p) => p.right),
          `${seed}:rights`,
        ),
      };
    default:
      return step;
  }
}
