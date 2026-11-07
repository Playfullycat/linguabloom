import { z } from "zod";

import prompts from "../../content/writing/prompts.json" with { type: "json" };
import { CEFR_LEVELS } from "../curriculum/domain/cefr";

/** Built-in writing tasks (spec §5.11). Reviewed content, versioned in the repo. */

export const WRITING_TYPES = ["rewrite", "diary", "email", "opinion", "summary", "free"] as const;
export type WritingType = (typeof WRITING_TYPES)[number];
export const WRITING_TYPE_LABELS: Record<WritingType, string> = {
  rewrite: "句子改写",
  diary: "日记 / 叙述",
  email: "邮件 / 消息",
  opinion: "观点表达",
  summary: "摘要",
  free: "自由写作",
};

const text = z.string().trim().min(1);

export const writingPromptSchema = z
  .object({
    id: z.string().regex(/^w-[a-z0-9]+(?:-[a-z0-9]+)*$/),
    type: z.enum(WRITING_TYPES),
    level: z.enum(CEFR_LEVELS),
    title_zh: text,
    title_en: text,
    task_zh: text,
    task_en: text,
    min_words: z.number().int().min(5),
    max_words: z.number().int().max(400),
    source_material: z.string().optional(),
    checklist_zh: z.array(text).min(1).max(4),
  })
  .refine((p) => p.min_words < p.max_words, "min_words must be below max_words");

export type WritingPrompt = z.infer<typeof writingPromptSchema>;

const fileSchema = z.object({
  schema_version: z.literal(1),
  source_type: z.literal("first_party"),
  review_status: z.enum(["unreviewed", "pending_owner_review", "reviewed"]),
  prompts: z.array(writingPromptSchema).min(1),
});

export function loadWritingPrompts(): WritingPrompt[] {
  const parsed = fileSchema.parse(prompts);
  const ids = parsed.prompts.map((p) => p.id);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate writing prompt id");
  return parsed.prompts;
}

export function countWords(text: string): number {
  return (text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*|\d+/g) ?? []).length;
}
