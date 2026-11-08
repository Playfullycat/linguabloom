import { z } from "zod";

import { CEFR_LEVELS } from "../domain/cefr";
import { publishProblems } from "./quality";

/**
 * Versioned course content schema (content_schema_version 1).
 *
 * Course content lives in reviewed JSON files under `content/` and is loaded
 * into PostgreSQL by the seed. Every file is validated against this schema
 * before anything is written. See docs/CONTENT_AUTHORING_GUIDE.md.
 */
export const CONTENT_SCHEMA_VERSION = 1;

const text = z.string().trim().min(1);
const slug = z.string().regex(/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/, "use lowercase-kebab ids");

export const SKILLS = [
  "listening",
  "reading",
  "spoken_production",
  "spoken_interaction",
  "written_production",
  "written_interaction",
  "mediation",
  "phonology",
  "vocabulary",
  "grammar",
] as const;
export type Skill = (typeof SKILLS)[number];

/** Pedagogical role of a step in the lesson arc (spec §3.5). */
export const STEP_ROLES = [
  "orientation",
  "warm_up",
  "input",
  "notice",
  "teach",
  "guided_practice",
  "retrieval_practice",
  "communicative_task",
  "exit_ticket",
] as const;
export type StepRole = (typeof STEP_ROLES)[number];

export const CONTENT_STATUSES = ["planned", "draft", "published", "archived"] as const;
export const REVIEW_STATUSES = ["unreviewed", "pending_owner_review", "reviewed"] as const;

const bilingual = z.object({ en: text, zh: text });
const example = z.object({ en: text, zh: text });

// ------------------------------------------------------------- steps ----

const stepBase = {
  /** Stable within the lesson, e.g. "s01". Used to key progress and attempts. */
  id: z.string().regex(/^s\d{2}$/, 'step ids look like "s01"'),
  role: z.enum(STEP_ROLES),
  skill: z.enum(SKILLS),
};

/** Non-assessed: what this lesson is for. */
const orientationStep = z.object({
  ...stepBase,
  type: z.literal("orientation"),
  title_zh: text,
  body_zh: text,
});

/** Meaning-focused input: a short dialogue, read aloud line by line. */
const dialogueStep = z.object({
  ...stepBase,
  type: z.literal("dialogue"),
  title_en: text,
  instructions_zh: text,
  /** Short scene description shown above the dialogue. */
  scene_zh: text.optional(),
  lines: z.array(z.object({ speaker: text, en: text, zh: text })).min(2),
});

/** Introduce new words/chunks (keys refer to the unit vocabulary list). */
const vocabStep = z.object({
  ...stepBase,
  type: z.literal("vocab"),
  instructions_zh: text,
  items: z.array(slug).min(1),
});

/** Guided noticing: look at examples, then reveal the pattern. */
const noticeStep = z.object({
  ...stepBase,
  type: z.literal("notice"),
  question_zh: text,
  examples: z
    .array(z.object({ en: text, zh: text, highlight: z.array(text).default([]) }))
    .min(2),
  takeaway_zh: text,
});

/** Short explicit explanation (Chinese scaffold for beginners). */
const teachStep = z.object({
  ...stepBase,
  type: z.literal("teach"),
  title_zh: text,
  explanation_zh: text,
  pattern: text.optional(),
  examples: z.array(example).min(1),
  tips_zh: z.array(text).default([]),
});

/** Single-answer multiple choice. With `audio_en`, the prompt is heard, not read. */
const choiceStep = z.object({
  ...stepBase,
  type: z.literal("choice"),
  prompt_zh: text.optional(),
  prompt_en: text.optional(),
  /** Played with text-to-speech; the text stays hidden until answered. */
  audio_en: text.optional(),
  options: z.array(text).min(2).max(5),
  answer: z.number().int().min(0),
  explanation_zh: text,
});

/** Type the missing word(s). The sentence marks the gap with "___". */
const clozeStep = z.object({
  ...stepBase,
  type: z.literal("cloze"),
  instructions_zh: text,
  sentence_en: text.refine((s) => s.split("___").length === 2, 'mark exactly one gap with "___"'),
  translation_zh: text,
  answers: z.array(text).min(1),
  hint_zh: text.optional(),
  explanation_zh: text,
});

/** Put the words in order. `answers` lists every accepted full sentence. */
const orderStep = z.object({
  ...stepBase,
  type: z.literal("order"),
  instructions_zh: text,
  translation_zh: text,
  tokens: z.array(text).min(2),
  answers: z.array(text).min(1),
  explanation_zh: text,
});

/** Match left items to right items. */
const matchStep = z.object({
  ...stepBase,
  type: z.literal("match"),
  instructions_zh: text,
  pairs: z
    .array(z.object({ left: text, right: text }))
    .min(2)
    .max(6)
    .refine((pairs) => new Set(pairs.map((p) => p.left)).size === pairs.length, "match lefts must be unique")
    .refine((pairs) => new Set(pairs.map((p) => p.right)).size === pairs.length, "match rights must be unique"),
});

/** Open spoken output: record (optional) or type; model + self-check rubric. */
const speakStep = z.object({
  ...stepBase,
  type: z.literal("speak"),
  task_zh: text,
  /** Situation / partner line, read aloud before the learner answers. */
  prompt_en: text.optional(),
  model_answers: z.array(text).min(1),
  checklist_zh: z.array(text).min(1),
});

/** Open written output with model answers and a self-check rubric. */
const writeStep = z.object({
  ...stepBase,
  type: z.literal("write"),
  task_zh: text,
  model_answers: z.array(text).min(1),
  checklist_zh: z.array(text).min(1),
});

export const stepSchema = z.discriminatedUnion("type", [
  orientationStep,
  dialogueStep,
  vocabStep,
  noticeStep,
  teachStep,
  choiceStep,
  clozeStep,
  orderStep,
  matchStep,
  speakStep,
  writeStep,
]);
export type LessonStepContent = z.infer<typeof stepSchema>;
export type StepType = LessonStepContent["type"];

/** Steps that require an answer. Objective ones are scored automatically. */
export const OBJECTIVE_STEP_TYPES = ["choice", "cloze", "order", "match"] as const satisfies StepType[];
export const OPEN_STEP_TYPES = ["speak", "write"] as const satisfies StepType[];

export function isAssessedStepType(type: StepType): boolean {
  return (OBJECTIVE_STEP_TYPES as readonly string[]).includes(type) || (OPEN_STEP_TYPES as readonly string[]).includes(type);
}

// ------------------------------------------------- lesson / unit file ----

export const lessonSchema = z
  .object({
    id: slug,
    order: z.number().int().min(1),
    kind: z.enum(["core", "review"]),
    title_en: text,
    title_zh: text,
    estimated_minutes: z.number().int().min(3).max(20),
    objectives: z.array(bilingual).min(2).max(4),
    can_do_ids: z.array(slug).min(1),
    steps: z.array(stepSchema).min(4),
  })
  .superRefine((lesson, ctx) => {
    const ids = lesson.steps.map((s) => s.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "duplicate step ids" });
    if (!lesson.steps.some((s) => s.role === "exit_ticket")) {
      ctx.addIssue({ code: "custom", message: "every lesson needs at least one exit_ticket step" });
    }
    for (const [i, step] of lesson.steps.entries()) {
      if (step.type === "choice" && step.answer >= step.options.length) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "answer"], message: "answer index out of range" });
      }
      if (step.role === "exit_ticket" && !isAssessedStepType(step.type)) {
        ctx.addIssue({ code: "custom", path: ["steps", i], message: "exit_ticket steps must be assessed" });
      }
    }
  });
export type LessonContent = z.infer<typeof lessonSchema>;

export const vocabularyItemSchema = z.object({
  key: slug,
  /** Word or chunk as taught, e.g. "Good morning". */
  text: text,
  pos: text,
  ipa: text.optional(),
  zh: text,
  example_en: text,
  example_zh: text,
});
export type VocabularyItem = z.infer<typeof vocabularyItemSchema>;

export const canDoSchema = z.object({
  id: slug,
  skill: z.enum(SKILLS),
  en: text,
  zh: text,
});

export const grammarPointSchema = z.object({
  id: slug,
  title_en: text,
  title_zh: text,
  pattern: text,
  explanation_zh: text,
  examples: z.array(example).min(2),
  common_errors: z.array(z.object({ wrong: text, right: text, why_zh: text })).default([]),
});

/** A fully authored unit (status published/draft) with lessons. */
export const unitFileSchema = z
  .object({
    content_schema_version: z.literal(CONTENT_SCHEMA_VERSION),
    source_type: z.enum(["first_party", "licensed", "public_domain"]),
    /** Required for licensed / public-domain content (publish gate). */
    source: z.object({ title: text, url: z.url().optional(), license: text }).optional(),
    review_status: z.enum(REVIEW_STATUSES),
    unit: z.object({
      id: slug,
      level: z.enum(CEFR_LEVELS),
      order: z.number().int().min(1),
      status: z.enum(["draft", "published"]),
      title_en: text,
      title_zh: text,
      summary_zh: text,
      can_do: z.array(canDoSchema).min(1),
      grammar_points: z.array(grammarPointSchema).min(1),
      vocabulary: z.array(vocabularyItemSchema).min(4),
      lessons: z.array(lessonSchema).min(1),
    }),
  })
  .superRefine((file, ctx) => {
    const { unit } = file;
    const vocabKeys = new Set(unit.vocabulary.map((v) => v.key));
    const canDoIds = new Set(unit.can_do.map((c) => c.id));
    if (vocabKeys.size !== unit.vocabulary.length) ctx.addIssue({ code: "custom", message: "duplicate vocabulary keys" });

    const lessonIds = unit.lessons.map((l) => l.id);
    if (new Set(lessonIds).size !== lessonIds.length) ctx.addIssue({ code: "custom", message: "duplicate lesson ids" });

    for (const [li, lesson] of unit.lessons.entries()) {
      if (!lesson.id.startsWith(`${unit.id}-`)) {
        ctx.addIssue({ code: "custom", path: ["unit", "lessons", li, "id"], message: `lesson ids must start with "${unit.id}-"` });
      }
      // A lesson may also give evidence for a level-wide statement from
      // src/content/can-do/catalog.json ("a2.sp.past-events"); those ids are
      // checked when the can-do statements are loaded.
      for (const id of lesson.can_do_ids) {
        if (!canDoIds.has(id) && !id.startsWith(`${unit.level.replace("_", "-")}.`)) {
          ctx.addIssue({ code: "custom", path: ["unit", "lessons", li], message: `unknown can-do id ${id}` });
        }
      }
      if (!lesson.can_do_ids.some((id) => canDoIds.has(id))) {
        ctx.addIssue({ code: "custom", path: ["unit", "lessons", li], message: "each lesson needs at least one of the unit's own can-do statements" });
      }
      for (const [si, step] of lesson.steps.entries()) {
        if (step.type !== "vocab") continue;
        for (const key of step.items) {
          if (!vocabKeys.has(key)) {
            ctx.addIssue({ code: "custom", path: ["unit", "lessons", li, "steps", si], message: `unknown vocabulary key ${key}` });
          }
        }
      }
    }

    if (unit.status === "published") {
      for (const message of publishProblems(file)) ctx.addIssue({ code: "custom", message: `publish gate: ${message}` });
    }
  });
export type UnitFile = z.infer<typeof unitFileSchema>;

/** Course catalog: every level and unit, including planned ones. */
export const catalogSchema = z.object({
  content_schema_version: z.literal(CONTENT_SCHEMA_VERSION),
  course: z.object({
    id: slug,
    title_en: text,
    title_zh: text,
    summary_zh: text,
    source_type: z.enum(["first_party", "licensed", "public_domain"]),
  }),
  units: z.array(
    z.object({
      id: slug,
      level: z.enum(CEFR_LEVELS),
      order: z.number().int().min(1),
      title_en: text,
      title_zh: text,
      summary_zh: text,
      /** Path of the full unit file (relative to content/), when authored. */
      file: z.string().optional(),
    }),
  ),
});
export type Catalog = z.infer<typeof catalogSchema>;
