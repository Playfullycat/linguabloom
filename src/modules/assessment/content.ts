import { z } from "zod";

import bank from "../../content/assessment/diagnostic-v1.json" with { type: "json" };
import { CEFR_LEVELS } from "../curriculum/domain/cefr";

/** Placement item bank (spec §4.2): every item stores CEFR, skill, difficulty and discrimination. */

export const DIAGNOSTIC_SKILLS = ["vocabulary", "grammar", "reading", "listening"] as const;
export type DiagnosticSkill = (typeof DIAGNOSTIC_SKILLS)[number];

const text = z.string().trim().min(1);

const base = {
  id: z.string().regex(/^[a-z]{2,3}-[a-z0-9]+-\d+$/),
  skill: z.enum(DIAGNOSTIC_SKILLS),
  subskill: z.enum(["recognition", "recall"]).optional(),
  level: z.enum(CEFR_LEVELS),
  difficulty: z.number().min(1).max(5),
  discrimination: z.number().min(0).max(1),
  prompt_zh: text.optional(),
  prompt_en: text.optional(),
  explanation_zh: text,
};

const choiceItem = z
  .object({
    ...base,
    type: z.literal("choice"),
    audio_en: text.optional(),
    passage_en: text.optional(),
    options: z.array(text).min(2).max(5),
    answer: z.number().int().min(0),
  })
  .refine((i) => i.answer < i.options.length, "answer index out of range");

const clozeItem = z.object({
  ...base,
  type: z.literal("cloze"),
  sentence_en: text.refine((s) => s.split("___").length === 2, 'mark exactly one gap with "___"'),
  translation_zh: text,
  answers: z.array(text).min(1),
});

export const assessmentItemSchema = z.union([choiceItem, clozeItem]);
export type AssessmentItemContent = z.infer<typeof assessmentItemSchema>;

export const itemBankSchema = z
  .object({
    bank_version: z.string().min(1),
    source_type: z.enum(["first_party", "licensed", "public_domain"]),
    review_status: z.enum(["unreviewed", "pending_owner_review", "reviewed"]),
    note: z.string().optional(),
    items: z.array(assessmentItemSchema).min(1),
  })
  .superRefine((b, ctx) => {
    const ids = b.items.map((i) => i.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "duplicate item ids" });
    for (const skill of DIAGNOSTIC_SKILLS) {
      for (const level of CEFR_LEVELS) {
        if (!b.items.some((i) => i.skill === skill && i.level === level)) {
          ctx.addIssue({ code: "custom", message: `no ${skill} item at ${level}` });
        }
      }
    }
  });

export function loadItemBank() {
  return itemBankSchema.parse(bank);
}

export const DIAGNOSTIC_SKILL_LABELS: Record<DiagnosticSkill, string> = {
  vocabulary: "词汇",
  grammar: "语法",
  reading: "阅读",
  listening: "听力",
};
