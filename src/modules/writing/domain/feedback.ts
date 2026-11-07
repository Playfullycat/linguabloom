import { z } from "zod";

import { ERROR_CATEGORIES } from "../../../db/schema/grammar";
import { AIError } from "../../ai/provider/errors";

/**
 * Layered writing feedback (spec §5.11, §10.4): task completion → content →
 * grammar → vocabulary → organisation → natural expressions, with confidence,
 * evidence and limitations. The most important problems come first; a model
 * rewrite is optional and only shown when the learner asks.
 */

export const RUBRIC_VERSION = "writing-v1";

const clip = (n: number) => z.string().trim().max(n * 2).transform((s) => s.slice(0, n));
const nullableText = (n: number) => clip(n).nullish().transform((v) => v || null);
const list = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .array(item)
    .nullish()
    .transform((v) => (v ?? []).slice(0, max) as z.infer<T>[]);

export const writingFeedbackSchema = z.object({
  task_completion: z.object({ rating: z.enum(["met", "partly", "not_met"]), comment_zh: clip(600) }),
  content: z.object({ clear: z.boolean(), comment_zh: clip(600) }),
  grammar: list(
    z.object({
      original: clip(300).pipe(z.string().min(1)),
      corrected: clip(300).pipe(z.string().min(1)),
      explanation_zh: clip(400),
      category: z.enum(ERROR_CATEGORIES).catch("word_form"),
      grammar_point: nullableText(60),
      severity: z.enum(["high", "medium", "low"]).catch("medium"),
    }),
    12,
  ),
  vocabulary: list(z.object({ original: clip(120).pipe(z.string().min(1)), suggestion: clip(120).pipe(z.string().min(1)), explanation_zh: clip(300) }), 8),
  organization: z.object({ comment_zh: clip(600), suggestions_zh: list(clip(200), 4) }),
  natural_expressions: list(z.object({ original: clip(200).pipe(z.string().min(1)), better: clip(200).pipe(z.string().min(1)), note_zh: clip(300) }), 6),
  priorities: list(clip(200), 3),
  level_evidence: z
    .object({ level: z.enum(["Pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"]), comment_zh: clip(300) })
    .nullish()
    .transform((v) => v ?? null),
  confidence: z.enum(["low", "medium", "high"]),
  evidence: list(clip(200), 5),
  limitations: list(clip(200), 5),
  next_action: clip(300),
  model_rewrite: nullableText(3000),
  comparison: z
    .object({ improved: list(clip(200), 5), still_to_fix: list(clip(200), 5) })
    .nullish()
    .transform((v) => v ?? null),
});

export type WritingFeedback = z.infer<typeof writingFeedbackSchema>;

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

/**
 * Parse and check the model's feedback against the learner's text. Problems
 * quoting words the learner never wrote are dropped (the model must not
 * invent mistakes), and unknown grammar points become null.
 */
export function parseWritingFeedback(raw: string, learnerText: string, grammarPointIds: Set<string>): { feedback: WritingFeedback; dropped: number } {
  const candidates = [raw, raw.replace(/^```(?:json)?\s*|\s*```$/g, ""), raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    if (!c.trim().startsWith("{")) continue;
    let data: unknown;
    try {
      data = JSON.parse(c);
    } catch {
      continue;
    }
    const parsed = writingFeedbackSchema.safeParse(data);
    if (!parsed.success) continue;
    const text = norm(learnerText);
    const f = parsed.data;
    const grammar = f.grammar
      .filter((g) => text.includes(norm(g.original)) && norm(g.original) !== norm(g.corrected))
      .map((g) => ({ ...g, grammar_point: g.grammar_point && grammarPointIds.has(g.grammar_point) ? g.grammar_point : null }));
    const vocabulary = f.vocabulary.filter((v) => text.includes(norm(v.original)));
    const natural = f.natural_expressions.filter((n) => text.includes(norm(n.original)));
    const dropped = f.grammar.length - grammar.length + (f.vocabulary.length - vocabulary.length) + (f.natural_expressions.length - natural.length);
    // Most serious first (spec: fix the most important problems before polishing).
    const order = { high: 0, medium: 1, low: 2 } as const;
    grammar.sort((a, b) => order[a.severity] - order[b.severity]);
    return { feedback: { ...f, grammar, vocabulary, natural_expressions: natural }, dropped };
  }
  throw new AIError("invalid_response", "writing feedback failed validation");
}
