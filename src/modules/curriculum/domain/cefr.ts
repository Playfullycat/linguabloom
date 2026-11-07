/**
 * CEFR levels used across the app (Council of Europe, CEFR Companion Volume).
 * A level describes observable abilities, not a fixed vocabulary size.
 */
export const CEFR_LEVELS = ["pre_a1", "a1", "a2", "b1", "b2", "c1", "c2"] as const;

export type CefrLevel = (typeof CEFR_LEVELS)[number];

export const CEFR_LEVEL_LABELS: Record<CefrLevel, string> = {
  pre_a1: "Pre-A1",
  a1: "A1",
  a2: "A2",
  b1: "B1",
  b2: "B2",
  c1: "C1",
  c2: "C2",
};

export function isCefrLevel(value: unknown): value is CefrLevel {
  return typeof value === "string" && (CEFR_LEVELS as readonly string[]).includes(value);
}

/** Ordering helper: negative if `a` is below `b`. */
export function compareCefrLevels(a: CefrLevel, b: CefrLevel): number {
  return CEFR_LEVELS.indexOf(a) - CEFR_LEVELS.indexOf(b);
}
