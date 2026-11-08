import { z } from "zod";

import { AIError } from "../../ai/provider/errors";

/**
 * AI-assisted feedback for PTE answers that have no objective key: written
 * summaries and essays, and spoken answers (from their transcript). Shown
 * apart from objective scoring and never as Pearson points (spec §5.13):
 * comments per dimension, key points covered / missed, a few quoted
 * corrections, confidence and limitations.
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
  /** Task-specific dimensions (register, attribution, development …). */
  extra: list(z.object({ key: clip(30), name_zh: clip(30), comment_zh: clip(300) }), 4),
  overall_zh: clip(300),
  confidence: z.enum(["low", "medium", "high"]).catch("low"),
  limitations: list(clip(200), 4),
});

export type PteWrittenFeedback = z.infer<typeof pteWrittenFeedbackSchema> & { not_official_zh: string; spoken?: boolean };

export const NOT_OFFICIAL = "这是 AI 辅助反馈，不是 Pearson 的评分，也不能换算成 PTE 分数。";
export const SPOKEN_NOTE = "口语题只根据自动转写的文字反馈：发音和流利度没有评估，口音不同不算错；转写出错会影响反馈。";

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

/** Validate; drop corrections and spelling errors that quote words the learner didn't write. */
export function parsePteWrittenFeedback(raw: string, learnerText: string, spoken = false): PteWrittenFeedback {
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
      // A transcript has no spelling of its own.
      spelling: { errors: spoken ? [] : f.spelling.errors.filter((e) => wordsSaid.has(norm(e.wrong)) && norm(e.wrong) !== norm(e.right)) },
      confidence: f.confidence === "high" ? "medium" : f.confidence,
      not_official_zh: NOT_OFFICIAL,
      spoken,
    };
  }
  throw new AIError("invalid_response", "pte feedback failed validation");
}

const TASK_BRIEF: Record<string, string> = {
  l_sst: "'Summarize Spoken Text': the learner listened to a recording and wrote a 50–70 word summary.",
  sw_describe_image: "'Describe Image': the learner described a chart in about 40 seconds of speech (you get the chart data and the transcript).",
  sw_retell_lecture: "'Retell Lecture': the learner retold the main points of a short lecture in about 40 seconds of speech.",
  sw_summarize_group_discussion: "'Summarize Group Discussion': the learner summarized a three-person discussion in up to 2 minutes, saying who said what.",
  sw_respond_situation: "'Respond to a Situation': the learner gave a spoken response to a workplace or everyday situation; register (formality) matters.",
  sw_summarize_written_text: "'Summarize Written Text': the learner wrote ONE sentence (5–75 words) summarizing a passage.",
  sw_write_essay: "'Write Essay': the learner wrote a 200–300 word argumentative essay.",
};

const EXTRA: Record<string, string> = {
  sw_respond_situation: 'Add an "extra" item {"key":"register","name_zh":"语气与场合",...} about whether the tone suits the listener.',
  sw_summarize_group_discussion: 'Add an "extra" item {"key":"attribution","name_zh":"观点归属",...} about whether each point is attributed to the right speaker.',
  sw_write_essay: 'Add an "extra" item {"key":"development","name_zh":"展开与连贯",...} about reasons, examples and paragraph links.',
};

/** System prompt for AI-assisted feedback on any PTE spoken or written task (never a score). */
export function pteFeedbackPrompt(task: string, ctx: { keyPointsZh: string[]; registerZh?: string; explanation: "zh" | "mixed" | "en"; spoken: boolean }) {
  return [
    "You give feedback on a PTE Academic practice answer by an adult learner whose first language is Chinese.",
    `MODE: pte_${task}`,
    TASK_BRIEF[task] ?? "",
    "You get the source (recording transcript, passage, chart data or situation), the key points and the learner's answer.",
    ctx.spoken
      ? "The answer is an AUTOMATIC TRANSCRIPT of speech: do not comment on spelling or punctuation, and do not assess pronunciation or fluency (you cannot hear it). An accent is never an error; if something looks like a transcription mistake, ignore it."
      : "Comment on spelling as well.",
    "Comment on content (which key points are covered or missing; whether it misrepresents the source), grammar and vocabulary. Quote the learner's exact words for every grammar issue and spelling error; do not invent mistakes.",
    EXTRA[task] ?? "",
    ctx.registerZh ? `Expected register: ${ctx.registerZh}` : "",
    "Do NOT give scores or numbers and never claim this equals a Pearson score. Word counts are checked by the program, not by you.",
    `Write comments in ${ctx.explanation === "en" ? "simple English" : "Chinese (Simplified)"}.`,
    `Key points: ${ctx.keyPointsZh.join("; ")}`,
    'Reply with ONE JSON object only: {"content":{"comment_zh":string,"covered":[string],"missing":[string],"misrepresents":boolean},"grammar":{"comment_zh":string,"issues":[{"original":string,"corrected":string}]},"vocabulary":{"comment_zh":string},"spelling":{"errors":[{"wrong":string,"right":string}]},"extra":[{"key":string,"name_zh":string,"comment_zh":string}],"overall_zh":string,"confidence":"low|medium|high","limitations":[string]}',
  ]
    .filter(Boolean)
    .join("\n");
}
