import { z } from "zod";

import a1Basics from "../../content/grammar/a1-basics.json" with { type: "json" };
import a1More from "../../content/grammar/a1-more.json" with { type: "json" };
import a2B1 from "../../content/grammar/a2-b1.json" with { type: "json" };
import planned from "../../content/grammar/planned.json" with { type: "json" };
import { ERROR_CATEGORIES } from "../../db/schema/grammar";
import { CEFR_LEVELS } from "../curriculum/domain/cefr";

/**
 * Grammar map and exercise bank (spec §3.6, §3.7, §5.5). One file holds a
 * few grammar points, each with its explanation, examples, sentence
 * breakdowns, common errors, contrast, limits and exercises.
 */

export const GRAMMAR_SCHEMA_VERSION = 1;
const text = z.string().trim().min(1);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const gap = text.refine((s) => s.split("___").length === 2, 'mark exactly one gap with "___"');

export const BREAKDOWN_ROLES = ["subject", "verb", "object", "complement", "time", "place", "adverb", "question", "other"] as const;
export type BreakdownRole = (typeof BREAKDOWN_ROLES)[number];

const base = {
  id: z.string().regex(/^e\d+$/),
  difficulty: z.number().min(1).max(5),
  explanation_zh: text,
  /** Overrides the point's default category for this exercise. */
  error_category: z.enum(ERROR_CATEGORIES).optional(),
};

const choice = z
  .object({ ...base, type: z.literal("choice"), prompt_zh: text.optional(), prompt_en: text.optional(), options: z.array(text).min(2).max(4), answer: z.number().int().min(0) })
  .refine((e) => e.answer < e.options.length, "answer index out of range")
  .refine((e) => e.prompt_zh || e.prompt_en, "choice needs a prompt");
const cloze = z.object({ ...base, type: z.literal("cloze"), instructions_zh: text.optional(), sentence_en: gap, translation_zh: text, answers: z.array(text).min(1) });
const order = z.object({ ...base, type: z.literal("order"), translation_zh: text, tokens: z.array(text).min(3), answers: z.array(text).min(1) });
const correction = z.object({ ...base, type: z.literal("correction"), wrong_en: text, translation_zh: text.optional(), answers: z.array(text).min(1) });
/** Open sentence building: model answers + a self-check list (no automatic scoring without AI). */
const build = z.object({ ...base, explanation_zh: text.optional(), type: z.literal("build"), task_zh: text, model_answers: z.array(text).min(1), checklist_zh: z.array(text).min(1).max(4) });

export const exerciseSchema = z.union([choice, cloze, order, correction, build]);
export type ExerciseContent = z.infer<typeof exerciseSchema>;
export type ExerciseType = ExerciseContent["type"];
export const SCORED_TYPES: ExerciseType[] = ["choice", "cloze", "order", "correction"];

const example = z.object({ en: text, zh: text });

export const grammarPointSchema = z
  .object({
    id: slug,
    order: z.number().int().min(1),
    level: z.enum(CEFR_LEVELS),
    /** Can-do statements this content gives evidence for (see src/content/can-do and the unit files). */
    can_do_ids: z.array(z.string().regex(/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/)).max(6).default([]),
    title_en: text,
    title_zh: text,
    status: z.enum(["published", "planned"]),
    topics: z.array(text).min(1),
    prerequisites: z.array(slug).default([]),
    unit_grammar_ids: z.array(text).default([]),
    default_error_category: z.enum(ERROR_CATEGORIES),
    summary_zh: text,
    explanation_zh: text.optional(),
    structure: z.array(text).optional(),
    usage_zh: z.array(text).optional(),
    examples: z.array(example).optional(),
    breakdowns: z
      .array(z.object({ zh: text, parts: z.array(z.object({ text, role: z.enum(BREAKDOWN_ROLES) })).min(2) }))
      .optional(),
    common_errors: z.array(z.object({ wrong: text, right: text, why_zh: text })).optional(),
    contrast: z.object({ title_zh: text, items: z.array(z.object({ en: text, zh: text, note_zh: text })).min(2) }).optional(),
    limits_zh: z.array(text).optional(),
    exercises: z.array(exerciseSchema).default([]),
  })
  .superRefine((p, ctx) => {
    if (p.status === "planned") {
      if (p.exercises.length > 0) ctx.addIssue({ code: "custom", message: `${p.id}: planned points have no exercises yet` });
      return;
    }
    for (const field of ["explanation_zh", "structure", "usage_zh", "examples", "breakdowns", "common_errors"] as const) {
      if (!p[field] || (Array.isArray(p[field]) && p[field].length === 0)) ctx.addIssue({ code: "custom", message: `${p.id}: published points need ${field}` });
    }
    const scored = p.exercises.filter((e) => SCORED_TYPES.includes(e.type));
    // Remediation uses 3 exercises and the retest 2 different ones (spec §2.8).
    if (scored.length < 5) ctx.addIssue({ code: "custom", message: `${p.id}: needs at least 5 scored exercises` });
    if (new Set(scored.map((e) => e.type)).size < 3) ctx.addIssue({ code: "custom", message: `${p.id}: use at least 3 scored exercise types` });
    const ids = p.exercises.map((e) => e.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: `${p.id}: duplicate exercise ids` });
    for (const e of p.exercises) {
      if (e.type === "order") {
        const sorted = (s: string[]) => [...s].map((t) => t.toLowerCase()).sort().join(" ");
        const answerWords = e.answers[0]!.replace(/[.?!,]/g, "").split(/\s+/);
        if (sorted(answerWords) !== sorted(e.tokens.map((t) => t.replace(/[.?!,]/g, "")))) {
          ctx.addIssue({ code: "custom", message: `${p.id}.${e.id}: order tokens must be exactly the words of the first answer` });
        }
      }
    }
  });

export type GrammarPointContent = z.infer<typeof grammarPointSchema>;

export const grammarFileSchema = z.object({
  schema_version: z.literal(GRAMMAR_SCHEMA_VERSION),
  source_type: z.enum(["first_party"]),
  review_status: z.enum(["unreviewed", "pending_owner_review", "reviewed"]),
  points: z.array(grammarPointSchema).min(1),
});

export const rawGrammarFiles: Record<string, unknown> = {
  "grammar/a1-basics.json": a1Basics,
  "grammar/a1-more.json": a1More,
  "grammar/a2-b1.json": a2B1,
  "grammar/planned.json": planned,
};

export function loadGrammar() {
  const points: (GrammarPointContent & { review_status: string })[] = [];
  for (const [path, raw] of Object.entries(rawGrammarFiles)) {
    const parsed = grammarFileSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`${path}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    for (const p of parsed.data.points) points.push({ ...p, review_status: parsed.data.review_status });
  }
  const ids = new Set(points.map((p) => p.id));
  if (ids.size !== points.length) throw new Error("duplicate grammar point ids");
  const orders = points.map((p) => p.order);
  if (new Set(orders).size !== orders.length) throw new Error("duplicate grammar point order");
  for (const p of points) {
    for (const pre of p.prerequisites) {
      if (!ids.has(pre)) throw new Error(`${p.id}: unknown prerequisite ${pre}`);
      if (points.find((x) => x.id === pre)!.order >= p.order) throw new Error(`${p.id}: prerequisite ${pre} must come earlier`);
    }
  }
  return points.sort((a, b) => a.order - b.order);
}

export const ERROR_CATEGORY_LABELS: Record<(typeof ERROR_CATEGORIES)[number], string> = {
  word_form: "词形",
  word_order: "词序",
  tense: "时态",
  agreement: "主谓一致",
  article: "冠词",
  preposition: "介词",
  spelling: "拼写",
  collocation: "搭配",
  pronunciation: "发音",
  listening: "听辨",
  pragmatics: "语用",
  comprehension: "语义理解",
  task: "任务理解",
};

export const BREAKDOWN_ROLE_LABELS: Record<BreakdownRole, string> = {
  subject: "主语",
  verb: "谓语",
  object: "宾语",
  complement: "表语 / 补语",
  time: "时间",
  place: "地点",
  adverb: "状语",
  question: "疑问词",
  other: "其他",
};
