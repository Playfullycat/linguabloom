import { z } from "zod";

import { ERROR_CATEGORIES } from "../../../db/schema/grammar";
import { AIError } from "../../ai/provider/errors";

/**
 * Post-session speaking feedback (spec §5.10 feedback dimensions): task
 * completion, comprehensibility, fluency, grammar, vocabulary, self-correction
 * and CEFR-aligned can-do evidence.
 *
 * The evaluator only sees the automatic transcript, so pronunciation is never
 * assessed (it cannot be judged reliably from text) and accent is never a
 * fault. Confidence is capped at "medium"; this is practice feedback, never an
 * official (PTE or other) score.
 */

export const SPEAKING_RUBRIC_VERSION = "speaking-v1";

const clip = (n: number) => z.string().trim().max(n * 2).transform((s) => s.slice(0, n));
const nullableText = (n: number) => clip(n).nullish().transform((v) => v || null);
const list = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .array(item)
    .nullish()
    .transform((v) => (v ?? []).slice(0, max) as z.infer<T>[]);

export const speakingFeedbackSchema = z.object({
  task_completion: z.object({ rating: z.enum(["met", "partly", "not_met"]), comment_zh: clip(400) }),
  comprehensibility: z.object({ rating: z.enum(["clear", "mostly_clear", "hard_to_follow"]).catch("mostly_clear"), comment_zh: clip(400) }),
  fluency: z.object({ comment_zh: clip(400) }),
  grammar: list(
    z.object({
      original: clip(300).pipe(z.string().min(1)),
      corrected: clip(300).pipe(z.string().min(1)),
      explanation_zh: clip(300),
      category: z.enum(ERROR_CATEGORIES).catch("word_form"),
      severity: z.enum(["high", "medium", "low"]).catch("medium"),
    }),
    5,
  ),
  vocabulary: z.object({
    comment_zh: clip(400),
    suggestions: list(z.object({ original: clip(120).pipe(z.string().min(1)), suggestion: clip(120).pipe(z.string().min(1)), explanation_zh: clip(240) }), 4),
  }),
  self_correction: nullableText(300),
  strengths: list(clip(160), 3),
  can_do_evidence: list(clip(160), 3),
  priorities: list(clip(200), 2),
  confidence: z.enum(["low", "medium", "high"]).catch("low"),
  limitations: list(clip(200), 5),
  next_action: clip(300),
});

export type SpeakingFeedback = z.infer<typeof speakingFeedbackSchema> & {
  /** Always set by the app, never by the model. */
  pronunciation_note_zh: string;
  rubric_version: string;
};

export const PRONUNCIATION_NOTE =
  "这次反馈只根据自动转写的文字，没有评价发音。口音不同不算错误；如果转写和你说的不一样，可能是转写识别的问题。";
export const FIXED_LIMITATIONS = ["基于自动语音转写：转写出错会影响反馈。", "这是练习反馈，不是 PTE 或任何官方考试的评分。"];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[.,!?;:"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Parse the model's feedback and check it against what the learner actually
 * said: quoted problems that aren't in the learner's own turns are dropped.
 * Confidence is lowered when there is little speech to judge.
 */
export function parseSpeakingFeedback(raw: string, learnerText: string, learnerWords: number): { feedback: SpeakingFeedback; dropped: number } {
  const candidates = [raw, raw.replace(/^```(?:json)?\s*|\s*```$/g, ""), raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    if (!c.trim().startsWith("{")) continue;
    let data: unknown;
    try {
      data = JSON.parse(c);
    } catch {
      continue;
    }
    const parsed = speakingFeedbackSchema.safeParse(data);
    if (!parsed.success) continue;
    const f = parsed.data;
    const said = norm(learnerText);
    const grammar = f.grammar.filter((g) => said.includes(norm(g.original)) && norm(g.original) !== norm(g.corrected));
    const suggestions = f.vocabulary.suggestions.filter((v) => said.includes(norm(v.original)));
    const dropped = f.grammar.length - grammar.length + (f.vocabulary.suggestions.length - suggestions.length);
    const order = { high: 0, medium: 1, low: 2 } as const;
    grammar.sort((a, b) => order[a.severity] - order[b.severity]);
    const confidence = learnerWords < 20 ? "low" : f.confidence === "high" ? "medium" : f.confidence;
    const limitations = [...FIXED_LIMITATIONS, ...f.limitations.filter((l) => !FIXED_LIMITATIONS.includes(l))].slice(0, 5);
    if (learnerWords < 20) limitations.splice(2, 0, "说的内容比较少，这次反馈只能作为参考。");
    return {
      feedback: {
        ...f,
        grammar,
        vocabulary: { ...f.vocabulary, suggestions },
        confidence,
        limitations: limitations.slice(0, 5),
        pronunciation_note_zh: PRONUNCIATION_NOTE,
        rubric_version: SPEAKING_RUBRIC_VERSION,
      },
      dropped,
    };
  }
  throw new AIError("invalid_response", "speaking feedback failed validation");
}
