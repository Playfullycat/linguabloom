import { z } from "zod";

import { AIError } from "../../ai/provider/errors";

/**
 * AI-assisted feedback for written PTE answers (Summarize Spoken Text in this
 * step). Shown apart from objective scoring and never as Pearson points
 * (spec §5.13): comments per dimension, key points covered / missed, a few
 * quoted corrections, confidence and limitations.
 */

const clip = (n: number) => z.string().trim().max(n * 2).transform((s) => s.slice(0, n));
const list = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .array(item)
    .nullish()
    .transform((v) => (v ?? []).slice(0, max) as z.infer<T>[]);

export const pteWrittenFeedbackSchema = z.object({
  content: z.object({ comment_zh: clip(400), covered: list(clip(160), 6), missing: list(clip(160), 6), misrepresents: z.boolean().catch(false) }),
  grammar: z.object({ comment_zh: clip(300), issues: list(z.object({ original: clip(200).pipe(z.string().min(1)), corrected: clip(200).pipe(z.string().min(1)) }), 4) }),
  vocabulary: z.object({ comment_zh: clip(300) }),
  spelling: z.object({ errors: list(z.object({ wrong: clip(40).pipe(z.string().min(1)), right: clip(40).pipe(z.string().min(1)) }), 8) }),
  overall_zh: clip(300),
  confidence: z.enum(["low", "medium", "high"]).catch("low"),
  limitations: list(clip(200), 4),
});

export type PteWrittenFeedback = z.infer<typeof pteWrittenFeedbackSchema> & { not_official_zh: string };

export const NOT_OFFICIAL = "这是 AI 辅助反馈，不是 Pearson 的评分，也不能换算成 PTE 分数。";

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

/** Validate; drop corrections and spelling errors that quote words the learner didn't write. */
export function parsePteWrittenFeedback(raw: string, learnerText: string): PteWrittenFeedback {
  const candidates = [raw, raw.replace(/^```(?:json)?\s*|\s*```$/g, ""), raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    if (!c.trim().startsWith("{")) continue;
    let data: unknown;
    try {
      data = JSON.parse(c);
    } catch {
      continue;
    }
    const parsed = pteWrittenFeedbackSchema.safeParse(data);
    if (!parsed.success) continue;
    const f = parsed.data;
    const said = norm(learnerText);
    const wordsSaid = new Set(said.split(/[^a-z']+/).filter(Boolean));
    return {
      ...f,
      grammar: { ...f.grammar, issues: f.grammar.issues.filter((i) => said.includes(norm(i.original))) },
      spelling: { errors: f.spelling.errors.filter((e) => wordsSaid.has(norm(e.wrong)) && norm(e.wrong) !== norm(e.right)) },
      confidence: f.confidence === "high" ? "medium" : f.confidence,
      not_official_zh: NOT_OFFICIAL,
    };
  }
  throw new AIError("invalid_response", "pte feedback failed validation");
}

export function sstFeedbackPrompt(keyPointsZh: string[], explanation: "zh" | "mixed" | "en") {
  return [
    "You give feedback on a PTE Academic 'Summarize Spoken Text' practice answer written by an adult learner whose first language is Chinese.",
    "MODE: pte_sst",
    "The learner listened to a recording and wrote a 50–70 word summary. You get the recording transcript, the key points, and the learner's summary.",
    "Comment on content (which key points are covered or missing; whether the summary misrepresents the recording), grammar, vocabulary and spelling. Quote the learner's exact words for every grammar issue and spelling error; do not invent mistakes.",
    "Do NOT give scores or numbers and never claim this equals a Pearson score. Word count is checked by the program, not by you.",
    `Write comments in ${explanation === "en" ? "simple English" : "Chinese (Simplified)"}.`,
    `Key points: ${keyPointsZh.join("; ")}`,
    'Reply with ONE JSON object only: {"content":{"comment_zh":string,"covered":[string],"missing":[string],"misrepresents":boolean},"grammar":{"comment_zh":string,"issues":[{"original":string,"corrected":string}]},"vocabulary":{"comment_zh":string},"spelling":{"errors":[{"wrong":string,"right":string}]},"overall_zh":string,"confidence":"low|medium|high","limitations":[string]}',
  ].join("\n");
}
