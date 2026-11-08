import { z } from "zod";

import preA1 from "../../content/materials/pre-a1.json" with { type: "json" };
import a1 from "../../content/materials/a1.json" with { type: "json" };
import a2 from "../../content/materials/a2.json" with { type: "json" };
import { CEFR_LEVELS } from "../curriculum/domain/cefr";

import { containsPhrase, words } from "./domain/text";

/**
 * Built-in graded reading and listening materials (spec §5.6, §5.7, §15).
 * Every word above the material's level must be in its glossary — that is
 * what the tap-a-word lookup shows (decision D50).
 */

export const MATERIAL_SCHEMA_VERSION = 1;
export const MATERIAL_TYPES = ["reading", "listening"] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];

const text = z.string().trim().min(1);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const glossaryEntry = z.object({
  key: slug,
  text,
  forms: z.array(text).optional(),
  pos: text,
  ipa: text.optional(),
  zh: text,
  note_zh: text.optional(),
});

const question = z
  .object({
    id: z.string().regex(/^q\d+$/),
    type: z.literal("choice"),
    prompt_zh: text,
    prompt_en: text.optional(),
    options: z.array(text).min(2).max(4),
    answer: z.number().int().min(0),
    explanation_zh: text,
    /** Sentence that holds the answer (0-based), for "find it in the text". */
    segment: z.number().int().min(0).optional(),
  })
  .refine((q) => q.answer < q.options.length, "answer index out of range");

const segment = z.object({ speaker: text.optional(), en: text, zh: text });

export const materialSchema = z
  .object({
    id: z.string().regex(/^(rd|ls)-[a-z0-9]+(?:-[a-z0-9]+)*$/),
    type: z.enum(MATERIAL_TYPES),
    level: z.enum(CEFR_LEVELS),
    /** Can-do statements this content gives evidence for (see src/content/can-do and the unit files). */
    can_do_ids: z.array(z.string().regex(/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/)).max(6).default([]),
    topic: text,
    title_en: text,
    title_zh: text,
    summary_zh: text,
    segments: z.array(segment).min(4).max(30),
    glossary: z.array(glossaryEntry).min(1),
    questions: z.array(question).min(2).max(6),
  })
  .superRefine((m, ctx) => {
    if ((m.type === "reading") !== m.id.startsWith("rd-")) ctx.addIssue({ code: "custom", message: `${m.id}: reading ids start with rd-, listening ids with ls-` });
    if (m.type === "listening" && m.segments.some((s) => !s.speaker)) ctx.addIssue({ code: "custom", message: `${m.id}: listening segments need a speaker` });
    const keys = m.glossary.map((g) => g.key);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: `${m.id}: duplicate glossary keys` });
    // The headword may be a base form ("book") as long as a listed form ("books") is in the text;
    // every listed form must really appear.
    const appears = (form: string) => containsPhrase(m.title_en, form) || m.segments.some((s) => containsPhrase(s.en, form));
    for (const g of m.glossary) {
      for (const form of g.forms ?? []) {
        if (!appears(form)) ctx.addIssue({ code: "custom", message: `${m.id}: glossary form "${form}" does not appear in the text` });
      }
      if (!g.forms?.length && !appears(g.text)) ctx.addIssue({ code: "custom", message: `${m.id}: glossary "${g.text}" does not appear in the text` });
    }
    const qids = m.questions.map((q) => q.id);
    if (new Set(qids).size !== qids.length) ctx.addIssue({ code: "custom", message: `${m.id}: duplicate question ids` });
    for (const q of m.questions) {
      if (q.segment !== undefined && q.segment >= m.segments.length) ctx.addIssue({ code: "custom", message: `${m.id}.${q.id}: segment out of range` });
    }
    for (const s of m.segments) {
      if (words(s.en).length > 30) ctx.addIssue({ code: "custom", message: `${m.id}: sentence too long for graded material: "${s.en.slice(0, 40)}…"` });
    }
  });

export type Material = z.infer<typeof materialSchema>;
export type MaterialQuestion = Material["questions"][number];

export const materialFileSchema = z.object({
  schema_version: z.literal(MATERIAL_SCHEMA_VERSION),
  source_type: z.enum(["first_party", "licensed", "public_domain"]),
  copyright_status: text,
  review_status: z.enum(["unreviewed", "pending_owner_review", "reviewed"]),
  materials: z.array(materialSchema).min(1),
});
export type MaterialFile = z.infer<typeof materialFileSchema>;

export const rawMaterialFiles: Record<string, unknown> = {
  "materials/pre-a1.json": preA1,
  "materials/a1.json": a1,
  "materials/a2.json": a2,
};

export function loadMaterials(): (Material & { file: Omit<MaterialFile, "materials"> })[] {
  const all: (Material & { file: Omit<MaterialFile, "materials"> })[] = [];
  for (const [path, raw] of Object.entries(rawMaterialFiles)) {
    const parsed = materialFileSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`${path}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    const { materials, ...file } = parsed.data;
    for (const m of materials) all.push({ ...m, file });
  }
  const ids = all.map((m) => m.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`duplicate material id ${dup}`);
  return all;
}
