import { createHash } from "node:crypto";

import { z } from "zod";

import versionsFile from "../../content/pte/exam-versions.json" with { type: "json" };
import listeningFile from "../../content/pte/prompts/listening.json" with { type: "json" };
import readingFile from "../../content/pte/prompts/reading.json" with { type: "json" };

/**
 * PTE Academic content (spec §5.13, §8.8): exam versions with their official
 * task types, and the original practice prompts. Each prompt is split into a
 * learner view (sent to the browser, no answers) and a key (server only).
 */

export const TASK_CODES = [
  "sw_read_aloud",
  "sw_repeat_sentence",
  "sw_describe_image",
  "sw_retell_lecture",
  "sw_answer_short_question",
  "sw_summarize_group_discussion",
  "sw_respond_situation",
  "sw_summarize_written_text",
  "sw_write_essay",
  "r_fib_dropdown",
  "r_mcma",
  "r_reorder",
  "r_fib_drag",
  "r_mcsa",
  "l_sst",
  "l_mcma",
  "l_fib_type",
  "l_hcs",
  "l_mcsa",
  "l_smw",
  "l_hiw",
  "l_wfd",
] as const;
export type TaskCode = (typeof TASK_CODES)[number];

export const SECTIONS = ["speaking_writing", "reading", "listening"] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABELS: Record<Section, string> = { speaking_writing: "口语与写作", reading: "阅读", listening: "听力" };

export const SCORING_METHODS = ["per_blank", "per_blank_typed", "mcma", "adjacent_pairs", "binary", "per_word", "hiw", "ai_traits"] as const;

const text = z.string().trim().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const taskTypeSchema = z.object({
  code: z.enum(TASK_CODES),
  section: z.enum(SECTIONS),
  order: z.number().int().min(1),
  name_en: text,
  name_zh: text,
  skills: z.array(z.enum(["listening", "reading", "speaking", "writing"])).min(1),
  timing: z.record(z.string(), z.unknown()).and(z.object({ suggested_seconds: z.number().int().positive().optional(), response_minutes: z.number().positive().optional() })),
  scoring: z.object({
    official_zh: text,
    method: z.enum(SCORING_METHODS),
    partial_credit: z.boolean(),
    negative_marking: z.boolean(),
    rule_zh: text.optional(),
    unconfirmed: z.boolean().optional(),
  }),
  description_zh: text,
  tips_zh: z.array(text).default([]),
  practice: z.boolean(),
});
export type TaskTypeContent = z.infer<typeof taskTypeSchema>;

const versionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  exam: z.literal("pte_academic"),
  label_zh: text,
  effective_from: date.nullable(),
  reviewed_on: date,
  is_current: z.boolean(),
  sources: z.array(z.object({ title: text, url: z.url({ protocol: /^https$/ }) })).min(1),
  notes_zh: z.array(text).default([]),
  task_types: z.array(taskTypeSchema).length(TASK_CODES.length),
  rubrics: z.array(z.object({ id: text, task_code: z.enum(TASK_CODES), rubric_version: text, traits: z.array(z.object({ key: text, name_zh: text, description_zh: text })).min(1) })).default([]),
});
export type ExamVersionContent = z.infer<typeof versionSchema>;

const script = z.array(z.object({ speaker: text.optional(), text })).min(1);
const options = z.array(text).min(3).max(6);
const why = text;

/** Per task type: what the author writes. Indices are checked in superRefine below. */
const promptContent = {
  r_fib_dropdown: z.object({ text, blanks: z.array(z.object({ options: z.array(text).min(3).max(5), answer: z.number().int().min(0) })).min(2).max(6), explanation_zh: why }),
  r_mcma: z.object({ passage: text, question: text, options, answers: z.array(z.number().int().min(0)).min(2), explanation_zh: why }),
  r_reorder: z.object({ items: z.array(text).min(3).max(6), explanation_zh: why }),
  r_fib_drag: z.object({ text, bank: z.array(text).min(3).max(10), answers: z.array(text).min(2).max(6), explanation_zh: why }),
  r_mcsa: z.object({ passage: text, question: text, options, answer: z.number().int().min(0), explanation_zh: why }),
  l_sst: z.object({ script, key_points_zh: z.array(text).min(2), model_summary: text }),
  l_mcma: z.object({ script, question: text, options, answers: z.array(z.number().int().min(0)).min(2), explanation_zh: why }),
  l_fib_type: z.object({ transcript: text, explanation_zh: why }),
  l_hcs: z.object({ script, options, answer: z.number().int().min(0), explanation_zh: why }),
  l_mcsa: z.object({ script, question: text, options, answer: z.number().int().min(0), explanation_zh: why }),
  l_smw: z.object({ script, options, answer: z.number().int().min(0), explanation_zh: why }),
  l_hiw: z.object({ transcript: text, explanation_zh: why }),
  l_wfd: z.object({ sentence: text }),
} as const;
export type PracticeTaskCode = keyof typeof promptContent;
export const PRACTICE_CODES = Object.keys(promptContent) as PracticeTaskCode[];

type ContentOf<T extends PracticeTaskCode> = z.infer<(typeof promptContent)[T]>;

const promptSchema = z.object({ id: z.string().regex(/^pte-[a-z0-9-]+$/), task: z.enum(PRACTICE_CODES as [PracticeTaskCode, ...PracticeTaskCode[]]), difficulty: z.number().int().min(1).max(5), title_zh: text, content: z.unknown() });

const promptFileSchema = z.object({ schema_version: z.literal(1), source_type: z.literal("first_party"), review_status: z.enum(["unreviewed", "pending_owner_review", "reviewed"]), prompts: z.array(promptSchema).min(1) });

export type PromptContent = { [K in PracticeTaskCode]: { task: K; content: ContentOf<K> } }[PracticeTaskCode];
export type Prompt = { id: string; difficulty: number; titleZh: string; reviewStatus: string; hash: string } & PromptContent;

const GAP = /\{(\d+)\}/g;
const TYPED = /\{([^{}]+)\}/g;
const HIW = /\[([^|\]]+)\|([^\]]+)\]/g;

/** Every content check that Zod can't express (indices in range, gaps match blanks, ...). */
function checkContent(p: PromptContent, problems: string[], id: string) {
  const bad = (m: string) => problems.push(`${id}: ${m}`);
  switch (p.task) {
    case "r_fib_dropdown": {
      const gaps = [...p.content.text.matchAll(GAP)].map((m) => Number(m[1]));
      if (gaps.join() !== p.content.blanks.map((_, i) => i + 1).join()) bad("gaps {1}..{n} must match the blanks in order");
      p.content.blanks.forEach((b, i) => b.answer >= b.options.length && bad(`blank ${i + 1}: answer out of range`));
      if (words(p.content.text) > 200) bad("text over 200 words");
      break;
    }
    case "r_fib_drag": {
      const gaps = [...p.content.text.matchAll(GAP)].map((m) => Number(m[1]));
      if (gaps.join() !== p.content.answers.map((_, i) => i + 1).join()) bad("gaps {1}..{n} must match the answers in order");
      for (const a of p.content.answers) if (!p.content.bank.includes(a)) bad(`answer "${a}" not in the bank`);
      if (p.content.bank.length <= p.content.answers.length) bad("the bank needs more words than gaps");
      if (words(p.content.text) > 80) bad("text over 80 words");
      break;
    }
    case "r_mcma":
    case "l_mcma":
      if (p.content.answers.some((a) => a >= p.content.options.length) || new Set(p.content.answers).size !== p.content.answers.length) bad("answers out of range or repeated");
      if (p.content.answers.length >= p.content.options.length) bad("not every option can be correct");
      if (p.task === "r_mcma" && words(p.content.passage) > 350) bad("passage over 350 words");
      break;
    case "r_mcsa":
    case "l_hcs":
    case "l_mcsa":
    case "l_smw":
      if (p.content.answer >= p.content.options.length) bad("answer out of range");
      if (p.task === "r_mcsa" && words(p.content.passage) > 110) bad("passage over 110 words");
      break;
    case "r_reorder":
      if (words(p.content.items.join(" ")) > 110) bad("text over 110 words");
      break;
    case "l_fib_type":
      if ([...p.content.transcript.matchAll(TYPED)].length < 2) bad("at least two {blanks}");
      break;
    case "l_hiw":
      if ([...p.content.transcript.matchAll(HIW)].length < 2) bad("at least two [shown|spoken] differences");
      break;
    default:
      break;
  }
}

export function words(s: string) {
  return (s.replace(/[{}[\]|]/g, " ").match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

let cache: { versions: ExamVersionContent[]; prompts: Prompt[] } | undefined;

export function loadPte() {
  if (cache) return cache;
  const problems: string[] = [];
  const versions = z.object({ schema_version: z.literal(1), versions: z.array(versionSchema).min(1) }).parse(versionsFile).versions;
  if (versions.filter((v) => v.is_current).length !== 1) problems.push("exactly one exam version must be current");
  for (const v of versions) {
    const codes = v.task_types.map((t) => t.code);
    if (new Set(codes).size !== codes.length) problems.push(`${v.id}: duplicate task codes`);
    for (const t of v.task_types) if (t.practice && !(PRACTICE_CODES as readonly string[]).includes(t.code)) problems.push(`${v.id}: ${t.code} marked practice but has no prompt format`);
  }

  const prompts: Prompt[] = [];
  for (const file of [readingFile, listeningFile]) {
    const parsed = promptFileSchema.parse(file);
    for (const raw of parsed.prompts) {
      const content = promptContent[raw.task].safeParse(raw.content);
      if (!content.success) {
        for (const issue of content.error.issues) problems.push(`${raw.id} content.${issue.path.join(".")}: ${issue.message}`);
        continue;
      }
      const p = { task: raw.task, content: content.data } as PromptContent;
      checkContent(p, problems, raw.id);
      const hash = createHash("sha256").update(JSON.stringify(raw.content)).digest("hex").slice(0, 16);
      prompts.push({ id: raw.id, difficulty: raw.difficulty, titleZh: raw.title_zh, reviewStatus: parsed.review_status, hash, ...p });
    }
  }
  const ids = prompts.map((p) => p.id);
  if (new Set(ids).size !== ids.length) problems.push("duplicate prompt ids");
  if (problems.length > 0) throw new Error(`Invalid PTE content:\n  ${problems.join("\n  ")}`);
  cache = { versions, prompts };
  return cache;
}

// ------------------------------------------------------------ views ----

/** Deterministic shuffle (same order every time for a prompt), so a reload doesn't reshuffle. */
export function seededOrder(n: number, seed: string): number[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  // Never show a reorder task already in the right order.
  if (n > 1 && order.every((v, i) => v === i)) order.push(order.shift()!);
  return order;
}

export type TextPart = { type: "text"; text: string } | { type: "gap"; index: number };

function gapParts(textWithGaps: string, re: RegExp): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  let i = 0;
  for (const m of textWithGaps.matchAll(re)) {
    if (m.index! > last) parts.push({ type: "text", text: textWithGaps.slice(last, m.index) });
    parts.push({ type: "gap", index: i });
    i += 1;
    last = m.index! + m[0].length;
  }
  if (last < textWithGaps.length) parts.push({ type: "text", text: textWithGaps.slice(last) });
  return parts;
}

/** Transcript tokens for "Highlight Incorrect Words": shown words, with which ones differ from the audio. */
export function hiwTokens(transcript: string): { tokens: { text: string; word: boolean }[]; incorrect: number[]; spoken: string } {
  const tokens: { text: string; word: boolean }[] = [];
  const incorrect: number[] = [];
  let spoken = "";
  const re = /\[([^|\]]+)\|([^\]]+)\]|([\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*)|([^\p{L}\p{N}[]+)/gu;
  for (const m of transcript.matchAll(re)) {
    if (m[1] !== undefined) {
      incorrect.push(tokens.length);
      tokens.push({ text: m[1], word: true });
      spoken += m[2];
    } else if (m[3] !== undefined) {
      tokens.push({ text: m[3], word: true });
      spoken += m[3];
    } else {
      tokens.push({ text: m[4]!, word: false });
      spoken += m[4];
    }
  }
  return { tokens, incorrect, spoken };
}

/** What the learner sees before answering (no answers, no listening scripts). */
export type LearnerView =
  | { task: "r_fib_dropdown"; parts: TextPart[]; options: string[][] }
  | { task: "r_mcma" | "r_mcsa"; passage: string; question: string; options: string[] }
  | { task: "r_reorder"; items: { id: string; text: string }[] }
  | { task: "r_fib_drag"; parts: TextPart[]; bank: string[] }
  | { task: "l_sst" | "l_wfd"; audio: true }
  | { task: "l_mcma" | "l_mcsa"; audio: true; question: string; options: string[] }
  | { task: "l_hcs" | "l_smw"; audio: true; options: string[] }
  | { task: "l_fib_type"; audio: true; parts: TextPart[] }
  | { task: "l_hiw"; audio: true; tokens: { text: string; word: boolean }[] };

export function learnerView(p: Prompt): LearnerView {
  switch (p.task) {
    case "r_fib_dropdown":
      return { task: p.task, parts: gapParts(p.content.text, GAP), options: p.content.blanks.map((b) => b.options) };
    case "r_mcma":
    case "r_mcsa":
      return { task: p.task, passage: p.content.passage, question: p.content.question, options: p.content.options };
    case "r_reorder": {
      const order = seededOrder(p.content.items.length, p.id);
      return { task: p.task, items: order.map((orig, pos) => ({ id: String.fromCharCode(65 + pos), text: p.content.items[orig]! })) };
    }
    case "r_fib_drag": {
      const order = seededOrder(p.content.bank.length, p.id);
      return { task: p.task, parts: gapParts(p.content.text, GAP), bank: order.map((i) => p.content.bank[i]!) };
    }
    case "l_sst":
    case "l_wfd":
      return { task: p.task, audio: true };
    case "l_mcma":
    case "l_mcsa":
      return { task: p.task, audio: true, question: p.content.question, options: p.content.options };
    case "l_hcs":
    case "l_smw":
      return { task: p.task, audio: true, options: p.content.options };
    case "l_fib_type":
      return { task: p.task, audio: true, parts: gapParts(p.content.transcript, TYPED) };
    case "l_hiw":
      return { task: p.task, audio: true, tokens: hiwTokens(p.content.transcript).tokens };
  }
}

/** The words the audio says (for speech synthesis). Null for reading tasks. */
export function audioScript(p: Prompt): string | null {
  switch (p.task) {
    case "l_sst":
    case "l_mcma":
    case "l_hcs":
    case "l_mcsa":
    case "l_smw":
      return p.content.script.map((s) => s.text).join(" ");
    case "l_fib_type":
      return p.content.transcript.replace(TYPED, (_, w: string) => w.split("/")[0]!);
    case "l_hiw":
      return hiwTokens(p.content.transcript).spoken;
    case "l_wfd":
      return p.content.sentence;
    default:
      return null;
  }
}

/** Typed-blank answers (alternatives separated by "/"). */
export function typedAnswers(transcript: string): string[][] {
  return [...transcript.matchAll(TYPED)].map((m) => m[1]!.split("/").map((s) => s.trim()));
}
