import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database, DbExecutor } from "@/db/connection";
import {
  aiDefinitions,
  aiGenerations,
  errorItems,
  errorOccurrences,
  exercises,
  grammarPoints,
  learningContents,
  transcriptSegments,
  userVocabulary,
  vocabularyEntries,
} from "@/db/schema";
import { getEnv } from "@/lib/config/env";
import { CEFR_LEVEL_LABELS, isCefrLevel, type CefrLevel } from "@/modules/curriculum/domain/cefr";
import { ERROR_CATEGORY_LABELS, exerciseSchema, SCORED_TYPES, type ExerciseContent } from "@/modules/grammar/content";
import { splitExercise } from "@/modules/grammar/domain/scoring";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { materialSchema, type Material } from "@/modules/materials/content";
import { containsPhrase, difficultyOf, type GlossaryEntry } from "@/modules/materials/domain/text";
import { MaterialNotFoundError, learnerInputLevel } from "@/modules/materials/services/materials";
import { addEntriesForUser } from "@/modules/review/services/vocabulary";

import { AIError } from "../provider/errors";
import type { AIProvider, AITask } from "../provider/types";
import { runAI } from "./usage";

/**
 * AI content generation (spec §10.3): schema-constrained prompt → Zod
 * validation → automatic quality checks → draft → learner preview → publish.
 * Nothing generated reaches the library without the learner's confirmation.
 */

export class GenerationNotFoundError extends Error {}
export class GenerationRejectedError extends Error {}

const CORE = "You write learning material for an adult Chinese-speaking learner of English. Be accurate and natural, suitable for the level. Never invent IPA, etymology or facts; prefer everyday fiction over factual claims. Reply with ONE JSON object only.";

function parseJson<T>(raw: string, schema: z.ZodType<T>): T {
  for (const c of [raw, raw.replace(/^```(?:json)?\s*|\s*```$/g, ""), raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)]) {
    if (!c.trim().startsWith("{")) continue;
    try {
      const parsed = schema.safeParse(JSON.parse(c));
      if (parsed.success) return parsed.data;
    } catch {
      // try the next candidate
    }
  }
  throw new AIError("invalid_response", "generated content failed validation");
}

async function callJson<T>(db: Database, userId: string, task: AITask, system: string, user: string, schema: z.ZodType<T>, provider?: AIProvider | null) {
  const { profile } = await getLearnerSettings(db, userId);
  const { value, provider: used } = await runAI({ db, userId, task, timeZone: profile.timezone, provider }, async (ai) => {
    const r = await ai.generateText({ task, system, messages: [{ role: "user", content: user }], json: true, maxOutputTokens: Math.max(getEnv().AI_MAX_OUTPUT_TOKENS, 2000) });
    return { value: parseJson(r.text, schema), usage: r.usage, model: r.model };
  });
  return { value, provider: used };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "word";

// ------------------------------------------------------------ definitions ----

const definitionSchema = z.object({
  text: z.string().trim().min(1).max(60),
  pos: z.string().trim().max(30).nullish().transform((v) => v || null),
  ipa: z.string().trim().max(60).nullish().transform((v) => v || null),
  zh: z.string().trim().min(1).max(200),
  explanation_zh: z.string().trim().max(400).nullish().transform((v) => v || null),
  example_en: z.string().trim().max(240).nullish().transform((v) => v || null),
  example_zh: z.string().trim().max(240).nullish().transform((v) => v || null),
});
export type AiDefinition = z.infer<typeof definitionSchema> & { cached: boolean };

/**
 * Explain a word in its sentence (when no glossary or course entry has it).
 * Cached per word + sentence, so the same lookup isn't paid twice.
 */
export async function explainWord(db: Database, userId: string, input: { word: string; sentence: string }, provider?: AIProvider | null): Promise<AiDefinition> {
  const word = input.word.trim().slice(0, 60);
  const sentence = input.sentence.trim().slice(0, 400);
  if (!word) throw new GenerationRejectedError("empty word");
  const key = word.toLowerCase();
  const hash = createHash("sha256").update(sentence.toLowerCase()).digest("hex").slice(0, 32);
  const [hit] = await db.select().from(aiDefinitions).where(and(eq(aiDefinitions.word, key), eq(aiDefinitions.contextHash, hash)));
  if (hit) {
    await db.update(aiDefinitions).set({ hits: sql`${aiDefinitions.hits} + 1` }).where(eq(aiDefinitions.id, hit.id));
    return { ...(hit.result as z.infer<typeof definitionSchema>), cached: true };
  }
  const { level } = await learnerInputLevel(db, userId, "reading");
  const system = [
    CORE,
    `LEVEL: ${CEFR_LEVEL_LABELS[level]}`,
    "MODE: definition",
    "Explain the word as it is used in the sentence, for this level. Chinese meaning first. Give IPA only if you are certain of it, otherwise null.",
    '{"text": the word or phrase in its dictionary form, "pos": string|null, "ipa": string|null, "zh": short Chinese meaning, "explanation_zh": one sentence of usage help, "example_en": a new simple example, "example_zh": its translation}',
  ].join("\n");
  const { value, provider: used } = await callJson(db, userId, "definition", system, `WORD: ${word}\nSENTENCE: ${sentence}`, definitionSchema, provider);
  await db.insert(aiDefinitions).values({ word: key, contextHash: hash, result: value, model: used.textModel }).onConflictDoNothing();
  return { ...value, cached: false };
}

/** Keep an AI-explained word: the learner's own entry with review cards (marked as AI-generated). */
export async function collectAiWord(db: Database, userId: string, d: z.infer<typeof definitionSchema>) {
  const def = definitionSchema.parse(d);
  const [existing] = await db
    .select({ id: vocabularyEntries.id })
    .from(userVocabulary)
    .innerJoin(vocabularyEntries, eq(vocabularyEntries.id, userVocabulary.entryId))
    .where(and(eq(userVocabulary.userId, userId), sql`lower(${vocabularyEntries.text}) = ${def.text.toLowerCase()}`))
    .limit(1);
  if (existing) return { added: false };
  const id = `user.${randomUUID()}`;
  const { level } = await learnerInputLevel(db, userId, "reading");
  await db.insert(vocabularyEntries).values({
    id,
    unitId: null,
    key: slug(def.text),
    text: def.text,
    partOfSpeech: def.pos ?? "",
    ipa: def.ipa,
    definitionZh: def.zh,
    exampleEn: def.example_en ?? "",
    exampleZh: def.example_zh ?? "",
    cefrLevel: level,
    sourceType: "ai_definition",
    ownerUserId: userId,
  });
  return { added: (await addEntriesForUser(db, userId, [id], "ai:definition")) > 0 };
}

// ------------------------------------------------------------- drafts ----

async function saveDraft(db: DbExecutor, userId: string, kind: string, targetRef: string | null, request: unknown, payload: unknown, warnings: string[], provider: AIProvider) {
  const [row] = await db
    .insert(aiGenerations)
    .values({ userId, kind, targetRef, request: request as object, payload: payload as object, warnings, provider: provider.name, model: provider.textModel })
    .returning({ id: aiGenerations.id });
  return row!.id;
}

export async function getGeneration(db: DbExecutor, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(aiGenerations)
    .where(and(eq(aiGenerations.id, id), eq(aiGenerations.userId, userId)));
  if (!row) throw new GenerationNotFoundError(id);
  return row;
}

export async function listGenerations(db: DbExecutor, userId: string, kind: string) {
  return db
    .select()
    .from(aiGenerations)
    .where(and(eq(aiGenerations.userId, userId), eq(aiGenerations.kind, kind), sql`${aiGenerations.status} <> 'discarded'`))
    .orderBy(desc(aiGenerations.createdAt))
    .limit(50);
}

export async function discardGeneration(db: DbExecutor, userId: string, id: string) {
  const g = await getGeneration(db, userId, id);
  if (g.status !== "draft") throw new GenerationRejectedError("not a draft");
  await db.update(aiGenerations).set({ status: "discarded" }).where(eq(aiGenerations.id, id));
}

async function insertGlossaryEntries(db: DbExecutor, userId: string, contentId: string, level: string, glossary: GlossaryEntry[], segments: { en: string; zh: string | null }[], sourceType: string) {
  for (const g of glossary) {
    const forms = [g.text, ...(g.forms ?? [])];
    const ex = segments.find((s) => forms.some((f) => containsPhrase(s.en, f)));
    await db
      .insert(vocabularyEntries)
      .values({
        id: `${contentId}.${g.key}`,
        unitId: null,
        key: g.key,
        text: g.text,
        partOfSpeech: g.pos,
        ipa: g.ipa ?? null,
        definitionZh: g.zh,
        exampleEn: ex?.en ?? "",
        exampleZh: ex?.zh ?? "",
        cefrLevel: level,
        sourceType,
        ownerUserId: userId,
      })
      .onConflictDoNothing();
  }
}

// ------------------------------------------------- material enrichment ----

const glossaryItem = z.object({
  text: z.string().trim().min(1).max(60),
  forms: z.array(z.string().trim().min(1).max(60)).max(5).optional(),
  pos: z.string().trim().min(1).max(30),
  ipa: z.string().trim().max(60).nullish(),
  zh: z.string().trim().min(1).max(160),
  note_zh: z.string().trim().max(240).nullish(),
});
const questionItem = z.object({
  prompt_zh: z.string().trim().min(1).max(200),
  options: z.array(z.string().trim().min(1).max(160)).min(2).max(4),
  answer: z.number().int().min(0),
  explanation_zh: z.string().trim().min(1).max(300),
  segment: z.number().int().min(0).nullish(),
});
const enrichmentSchema = z.object({ glossary: z.array(glossaryItem).max(20), questions: z.array(questionItem).max(6) });

/** Turn loose glossary items into checked entries; drop any word not in the text. */
function checkGlossary(items: z.infer<typeof glossaryItem>[], title: string, segments: string[], warnings: string[]): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  const keys = new Set<string>();
  const appears = (f: string) => containsPhrase(title, f) || segments.some((s) => containsPhrase(s, f));
  for (const g of items) {
    const forms = (g.forms ?? []).filter((f) => appears(f));
    if (!appears(g.text) && forms.length === 0) {
      warnings.push(`生词“${g.text}”不在原文里，已去掉。`);
      continue;
    }
    let key = slug(g.text);
    while (keys.has(key)) key = `${key}-x`;
    keys.add(key);
    out.push({ key, text: g.text, ...(forms.length ? { forms } : {}), pos: g.pos, ...(g.ipa ? { ipa: g.ipa } : {}), zh: g.zh, ...(g.note_zh ? { note_zh: g.note_zh } : {}) });
  }
  return out;
}

function checkQuestions(items: z.infer<typeof questionItem>[], segmentCount: number, warnings: string[]) {
  const out: Material["questions"] = [];
  items.forEach((q) => {
    if (q.answer >= q.options.length || new Set(q.options).size !== q.options.length) {
      warnings.push(`一道题的答案或选项有问题，已去掉：${q.prompt_zh}`);
      return;
    }
    out.push({ id: `q${out.length + 1}`, type: "choice", prompt_zh: q.prompt_zh, options: q.options, answer: q.answer, explanation_zh: q.explanation_zh, ...(q.segment != null && q.segment < segmentCount ? { segment: q.segment } : {}) });
  });
  return out;
}

/** Glossary + comprehension questions for an imported material that has none. */
export async function generateEnrichment(db: Database, userId: string, contentId: string, provider?: AIProvider | null) {
  const [m] = await db
    .select()
    .from(learningContents)
    .where(and(eq(learningContents.id, contentId), eq(learningContents.ownerUserId, userId)));
  if (!m) throw new MaterialNotFoundError(contentId);
  const segs = await db.select().from(transcriptSegments).where(eq(transcriptSegments.contentId, contentId)).orderBy(transcriptSegments.sequence);
  const level = isCefrLevel(m.cefrLevel) ? CEFR_LEVEL_LABELS[m.cefrLevel] : "A1";
  const system = [
    CORE,
    `LEVEL: ${level}`,
    "MODE: generate_enrichment",
    "Pick up to 12 words or phrases from the text that are above this level and give each a short Chinese meaning. Only use words that appear in the text exactly; list other forms that appear in \"forms\".",
    "Write 3–4 multiple-choice comprehension questions in Chinese, each answerable from one sentence (give its 0-based index in \"segment\"). Options short; exactly one correct.",
    '{"glossary":[{"text":string,"forms":[string],"pos":string,"ipa":string|null,"zh":string,"note_zh":string|null}],"questions":[{"prompt_zh":string,"options":[string],"answer":number,"explanation_zh":string,"segment":number}]}',
  ].join("\n");
  const textBlock = segs.map((s) => `[${s.sequence}] ${s.textEn}`).join("\n");
  const { value, provider: used } = await callJson(db, userId, "generation", system, `TITLE: ${m.titleEn}\nTEXT:\n${textBlock}`, enrichmentSchema, provider);
  const warnings: string[] = [];
  const glossary = checkGlossary(
    value.glossary,
    m.titleEn,
    segs.map((s) => s.textEn),
    warnings,
  );
  const questions = checkQuestions(value.questions, segs.length, warnings);
  if (glossary.length === 0 && questions.length === 0) throw new AIError("invalid_response", "nothing usable generated");
  return saveDraft(db, userId, "material_enrichment", contentId, { contentId }, { glossary, questions }, warnings, used);
}

// ------------------------------------------------------- graded reading ----

const LEVEL_SENTENCE_TARGET: Record<CefrLevel, number> = { pre_a1: 7, a1: 9, a2: 12, b1: 16, b2: 20, c1: 24, c2: 26 };

const gradedSchema = z.object({
  title_en: z.string().trim().min(1).max(80),
  title_zh: z.string().trim().min(1).max(60),
  summary_zh: z.string().trim().min(1).max(200),
  segments: z.array(z.object({ speaker: z.string().trim().max(30).nullish(), en: z.string().trim().min(1).max(300), zh: z.string().trim().min(1).max(300) })).min(4).max(30),
  glossary: z.array(glossaryItem).max(20),
  questions: z.array(questionItem).max(6),
});

export type GradedRequest = { topic: string; level: CefrLevel; type: "reading" | "listening" };

/** An original graded text at the learner's level (fiction or everyday scenes), as a draft. */
export async function generateGradedReading(db: Database, userId: string, req: GradedRequest, provider?: AIProvider | null) {
  const topic = req.topic.trim().slice(0, 80);
  if (!topic) throw new GenerationRejectedError("topic required");
  const label = CEFR_LEVEL_LABELS[req.level];
  const target = LEVEL_SENTENCE_TARGET[req.level];
  const system = [
    CORE,
    `LEVEL: ${label}`,
    `MODE: generate_graded_${req.type}`,
    req.type === "listening" ? "Write a natural dialogue between two named speakers (8–14 lines). Every line needs \"speaker\"." : "Write a short story or everyday scene (8–14 sentences), one sentence per segment.",
    `Keep sentences around ${target} words on average and never over 25 words. Use vocabulary and grammar typical for ${label}; put the few harder words in the glossary.`,
    "It must be fiction or an everyday scene, not factual claims about the real world. Give a Chinese translation for every segment.",
    "Glossary words must appear exactly in the text. 3–4 Chinese multiple-choice comprehension questions with the 0-based sentence index.",
    '{"title_en":string,"title_zh":string,"summary_zh":string,"segments":[{"speaker":string|null,"en":string,"zh":string}],"glossary":[{"text":string,"forms":[string],"pos":string,"ipa":string|null,"zh":string,"note_zh":string|null}],"questions":[{"prompt_zh":string,"options":[string],"answer":number,"explanation_zh":string,"segment":number}]}',
  ].join("\n");
  const { value, provider: used } = await callJson(db, userId, "generation", system, `TOPIC: ${topic}`, gradedSchema, provider);

  const warnings: string[] = [];
  const segments = value.segments.map((s) => ({ ...(req.type === "listening" ? { speaker: s.speaker || "Speaker" } : {}), en: s.en, zh: s.zh }));
  const glossary = checkGlossary(
    value.glossary,
    value.title_en,
    segments.map((s) => s.en),
    warnings,
  );
  const questions = checkQuestions(value.questions, segments.length, warnings);
  // Same rules as the built-in materials (sentence length, glossary in text, question shape).
  const candidate = {
    id: `${req.type === "listening" ? "ls" : "rd"}-ai-draft`,
    type: req.type,
    level: req.level,
    topic: topic.slice(0, 40),
    title_en: value.title_en,
    title_zh: value.title_zh,
    summary_zh: value.summary_zh,
    segments,
    glossary: glossary.length ? glossary : [],
    questions,
  };
  const checked = materialSchema.safeParse(candidate);
  if (!checked.success) {
    const problems = checked.error.issues.map((i) => i.message);
    // A missing glossary or too few questions is a quality warning; broken structure is not usable.
    const blocking = problems.filter((p) => !/glossary|Too small: expected array to have >=/.test(p));
    if (blocking.length > 0) throw new AIError("invalid_response", `generated material rejected: ${blocking[0]}`);
    warnings.push("生词表或理解题不够，发布前请自己检查。");
  }
  const avg = difficultyOf(
    segments.map((s) => s.en),
    glossary,
  ).averageSentenceLength;
  if (avg > target + 4) warnings.push(`平均句长 ${avg} 词，比 ${label} 的目标（约 ${target} 词）长，可能偏难。`);
  if (segments.some((s) => /[㐀-鿿]/.test(s.en))) warnings.push("英文句子里混入了中文，请检查。");
  return saveDraft(db, userId, "graded_reading", null, req, candidate, warnings, used);
}

// --------------------------------------------------------------- publish ----

export async function publishGeneration(db: Database, userId: string, id: string, now = new Date()) {
  const g = await getGeneration(db, userId, id);
  if (g.status !== "draft") throw new GenerationRejectedError("not a draft");

  if (g.kind === "material_enrichment") {
    const p = g.payload as { glossary: GlossaryEntry[]; questions: Material["questions"] };
    const [m] = await db
      .select()
      .from(learningContents)
      .where(and(eq(learningContents.id, g.targetRef!), eq(learningContents.ownerUserId, userId)));
    if (!m) throw new MaterialNotFoundError(g.targetRef!);
    const segs = await db.select().from(transcriptSegments).where(eq(transcriptSegments.contentId, m.id)).orderBy(transcriptSegments.sequence);
    await db.transaction(async (tx) => {
      await tx.update(learningContents).set({ content: { glossary: p.glossary, questions: p.questions } }).where(eq(learningContents.id, m.id));
      await insertGlossaryEntries(tx, userId, m.id, m.cefrLevel, p.glossary, segs.map((s) => ({ en: s.textEn, zh: s.textZh })), "ai_generated");
      await tx.update(aiGenerations).set({ status: "published", publishedAt: now, resultRef: m.id }).where(eq(aiGenerations.id, id));
    });
    return { kind: g.kind, contentId: m.id, type: m.type };
  }

  if (g.kind === "graded_reading") {
    const p = g.payload as Material;
    const contentId = `ai-${p.type === "listening" ? "ls" : "rd"}-${randomUUID().slice(0, 12)}`;
    await db.transaction(async (tx) => {
      await tx.insert(learningContents).values({
        id: contentId,
        type: p.type,
        titleEn: p.title_en,
        titleZh: p.title_zh,
        summaryZh: `${p.summary_zh}（AI 生成的虚构内容，已由你确认）`,
        cefrLevel: p.level,
        topic: p.topic,
        difficultyMetadata: difficultyOf(
          p.segments.map((s) => s.en),
          p.glossary,
        ),
        sourceType: "ai_generated",
        sourceUrl: null,
        copyrightStatus: "ai_generated",
        reviewStatus: "owner_reviewed",
        status: "published",
        ownerUserId: userId,
        content: { glossary: p.glossary, questions: p.questions },
        contentVersion: 1,
      });
      await tx.insert(transcriptSegments).values(p.segments.map((s, i) => ({ contentId, sequence: i, speaker: s.speaker ?? null, textEn: s.en, textZh: s.zh })));
      await insertGlossaryEntries(tx, userId, contentId, p.level, p.glossary, p.segments, "ai_generated");
      await tx.update(aiGenerations).set({ status: "published", publishedAt: now, resultRef: contentId }).where(eq(aiGenerations.id, id));
    });
    return { kind: g.kind, contentId, type: p.type };
  }

  if (g.kind === "micro_lesson") {
    const p = g.payload as MicroLesson;
    const ids: string[] = [];
    await db.transaction(async (tx) => {
      for (const [i, e] of p.exercises.entries()) {
        const { prompt, key, scoringRule } = splitExercise(e);
        const exId = `ai.${g.id.slice(0, 8)}.e${i + 1}`;
        ids.push(exId);
        await tx.insert(exercises).values({
          id: exId,
          grammarPointId: null,
          exerciseType: e.type,
          skill: "grammar",
          cefrLevel: p.level,
          difficulty: e.difficulty,
          prompt,
          answerKey: key,
          explanation: { zh: e.explanation_zh ?? null },
          errorCategory: p.category,
          scoringRule,
          sortOrder: i,
          ownerUserId: userId,
          generationId: g.id,
          contentVersion: 1,
        });
      }
      await tx.update(aiGenerations).set({ status: "published", publishedAt: now, resultRef: ids.join(",") }).where(eq(aiGenerations.id, id));
    });
    return { kind: g.kind, exerciseIds: ids };
  }
  throw new GenerationRejectedError(`unknown kind ${g.kind}`);
}

// ---------------------------------------------------------- micro-lesson ----

const microSchema = z.object({
  title_zh: z.string().trim().min(1).max(80),
  explanation_zh: z.string().trim().min(1).max(800),
  examples: z.array(z.object({ en: z.string().trim().min(1).max(200), zh: z.string().trim().min(1).max(200) })).min(1).max(4),
  exercises: z.array(z.unknown()).min(2).max(5),
});
export type MicroLesson = { title_zh: string; explanation_zh: string; examples: { en: string; zh: string }[]; exercises: ExerciseContent[]; level: CefrLevel; category: string };

/** A short lesson + 3 fresh exercises aimed at one recurring error (spec §2.8, §5.5). */
export async function generateMicroLesson(db: Database, userId: string, errorItemId: string, provider?: AIProvider | null) {
  const [item] = await db
    .select()
    .from(errorItems)
    .where(and(eq(errorItems.id, errorItemId), eq(errorItems.userId, userId)));
  if (!item) throw new GenerationNotFoundError(errorItemId);
  const occ = await db.select().from(errorOccurrences).where(eq(errorOccurrences.errorItemId, item.id)).orderBy(desc(errorOccurrences.createdAt)).limit(5);
  const [point] = item.pointType === "grammar" ? await db.select().from(grammarPoints).where(and(eq(grammarPoints.id, item.pointId), isNull(grammarPoints.archivedAt))) : [];
  const level: CefrLevel = point && isCefrLevel(point.level) ? point.level : (await learnerInputLevel(db, userId, "reading")).level;
  const category = ERROR_CATEGORY_LABELS[item.category as keyof typeof ERROR_CATEGORY_LABELS] ?? item.category;
  const system = [
    CORE,
    `LEVEL: ${CEFR_LEVEL_LABELS[level]}`,
    "MODE: generate_micro_lesson",
    "Write a very short lesson (in Chinese, with English examples) about this one mistake, then exactly 3 new exercises in new contexts (not the learner's own sentences).",
    'Exercise types allowed: {"id":"e1","type":"choice","difficulty":1-5,"prompt_en":string,"prompt_zh":string,"options":[string],"answer":number,"explanation_zh":string} | {"id":"e2","type":"cloze","difficulty":1-5,"sentence_en":"one ___ gap","translation_zh":string,"answers":[string],"explanation_zh":string} | {"id":"e3","type":"correction","difficulty":1-5,"wrong_en":string,"translation_zh":string,"answers":[string],"explanation_zh":string}',
    '{"title_zh":string,"explanation_zh":string,"examples":[{"en":string,"zh":string}],"exercises":[...3 exercises]}',
  ].join("\n");
  const user = [`ERROR: ${item.title} (${category})`, ...occ.map((o) => `WRONG: ${o.wrong ?? ""} → RIGHT: ${o.correct ?? ""}`)].join("\n");
  const { value, provider: used } = await callJson(db, userId, "generation", system, user, microSchema, provider);
  const warnings: string[] = [];
  const valid: ExerciseContent[] = [];
  value.exercises.forEach((raw, i) => {
    const parsed = exerciseSchema.safeParse({ ...(raw as object), id: `e${i + 1}` });
    if (parsed.success && SCORED_TYPES.includes(parsed.data.type)) valid.push(parsed.data);
    else warnings.push(`第 ${i + 1} 道题格式不对，已去掉。`);
  });
  if (valid.length < 2) throw new AIError("invalid_response", "micro-lesson needs at least 2 valid exercises");
  const lesson: MicroLesson = { title_zh: value.title_zh, explanation_zh: value.explanation_zh, examples: value.examples, exercises: valid, level, category: item.category };
  return saveDraft(db, userId, "micro_lesson", item.id, { errorItemId }, lesson, warnings, used);
}

/** The latest micro-lesson for an error item (draft or published). */
export async function latestMicroLesson(db: DbExecutor, userId: string, errorItemId: string) {
  const [g] = await db
    .select()
    .from(aiGenerations)
    .where(and(eq(aiGenerations.userId, userId), eq(aiGenerations.kind, "micro_lesson"), eq(aiGenerations.targetRef, errorItemId), sql`${aiGenerations.status} <> 'discarded'`))
    .orderBy(desc(aiGenerations.createdAt))
    .limit(1);
  return g ?? null;
}

