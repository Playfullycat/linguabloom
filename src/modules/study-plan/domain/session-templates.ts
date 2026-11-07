/**
 * Default study-session shapes by length (spec §2.9). The Phase 1 plan
 * builder fills each block with concrete tasks (due reviews, next lesson,
 * an input text, an output task); this module only defines the shape.
 *
 * Blocks map to Nation's Four Strands (spec §2.2) so the plan stays balanced
 * over time without forcing an exact 25% split.
 */

export const SESSION_LENGTHS = [15, 25, 40, 60] as const;
export type SessionLength = (typeof SESSION_LENGTHS)[number];

export const DEFAULT_SESSION_LENGTH: SessionLength = 25;

export type Strand =
  | "meaning_focused_input"
  | "meaning_focused_output"
  | "language_focused_learning"
  | "fluency_development";

export type SessionBlockKind = "review" | "lesson" | "input" | "output";

export type SessionBlock = {
  kind: SessionBlockKind;
  minutes: number;
  strand: Strand;
};

export const SESSION_BLOCK_LABELS: Record<SessionBlockKind, { title: string; detail: string }> = {
  review: { title: "到期复习", detail: "先回忆再看答案，巩固快要忘记的内容" },
  lesson: { title: "课程学习", detail: "当前单元的下一节短课" },
  input: { title: "阅读或听力", detail: "一小段能读懂、听懂的真实内容" },
  output: { title: "口语或写作", detail: "用上刚学的内容表达自己的意思" },
};

export const STRAND_LABELS: Record<Strand, string> = {
  meaning_focused_input: "意义输入",
  meaning_focused_output: "意义输出",
  language_focused_learning: "语言聚焦",
  fluency_development: "流利度",
};

const TEMPLATES: Record<SessionLength, SessionBlock[]> = {
  15: [
    { kind: "review", minutes: 8, strand: "language_focused_learning" },
    { kind: "input", minutes: 7, strand: "meaning_focused_input" },
  ],
  25: [
    { kind: "review", minutes: 10, strand: "language_focused_learning" },
    { kind: "lesson", minutes: 15, strand: "language_focused_learning" },
  ],
  40: [
    { kind: "review", minutes: 10, strand: "language_focused_learning" },
    { kind: "lesson", minutes: 18, strand: "language_focused_learning" },
    { kind: "output", minutes: 12, strand: "meaning_focused_output" },
  ],
  60: [
    { kind: "review", minutes: 12, strand: "language_focused_learning" },
    { kind: "lesson", minutes: 20, strand: "language_focused_learning" },
    { kind: "input", minutes: 15, strand: "meaning_focused_input" },
    { kind: "output", minutes: 13, strand: "meaning_focused_output" },
  ],
};

export function isSessionLength(value: unknown): value is SessionLength {
  return typeof value === "number" && (SESSION_LENGTHS as readonly number[]).includes(value);
}

export function getSessionTemplate(length: SessionLength): readonly SessionBlock[] {
  return TEMPLATES[length];
}
