import { and, desc, eq, isNull, like } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/connection";
import { grammarPoints, skillEstimates, writingSubmissions, type ErrorCategory } from "@/db/schema";
import { getEnv } from "@/lib/config/env";
import { runAI } from "@/modules/ai/services/usage";
import type { AIProvider } from "@/modules/ai/provider/types";
import { CEFR_LEVELS, CEFR_LEVEL_LABELS, type CefrLevel } from "@/modules/curriculum/domain/cefr";
import { recordError } from "@/modules/errors/services/errors";
import { ERROR_CATEGORY_LABELS } from "@/modules/grammar/content";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { learnerInputLevel } from "@/modules/materials/services/materials";

import { countWords, loadWritingPrompts, type WritingType } from "../content";
import { RUBRIC_VERSION, parseWritingFeedback, type WritingFeedback } from "../domain/feedback";

/**
 * Writing Studio (spec §5.11): write → layered AI feedback → second version
 * → comparison. Grammar problems the AI is reasonably sure about go into the
 * error notebook; low-confidence feedback never changes a skill estimate.
 */

export class WritingNotFoundError extends Error {}
export class WritingRejectedError extends Error {}

export const MAX_WRITING_CHARS = 4000;

export type WritingTask = { title: string; task: string; level: string; minWords: number; maxWords: number; checklist: string[] };

async function grammarPointList(db: DbExecutor) {
  return db
    .select({ id: grammarPoints.id, title: grammarPoints.titleZh })
    .from(grammarPoints)
    .where(and(isNull(grammarPoints.archivedAt), eq(grammarPoints.status, "published")));
}

function systemPrompt(task: WritingTask, explanation: string, points: { id: string; title: string }[], revision: boolean) {
  return [
    "You are a patient, accurate English writing teacher for an adult whose first language is Chinese.",
    `LEVEL: ${task.level}`,
    `MODE: writing_feedback${revision ? "_revision" : ""}`,
    `WORDS: ${task.minWords}-${task.maxWords}`,
    `Task given to the learner: ${task.title} — ${task.task}`,
    `Explanations in ${explanation === "en" ? "simple English" : "Chinese (Simplified)"}; quoted English stays in English.`,
    "Give layered feedback in this order of importance: task completion, whether the main content is clear, grammar, vocabulary and collocation, organisation and linking, more natural expressions.",
    "Correct the most important problems first; at most 8 grammar items. For each problem quote the learner's exact words in \"original\". Do not invent mistakes and do not penalise a correct alternative.",
    "Judge at the learner's level: do not demand advanced language from a beginner. Accents or regional spelling are not errors.",
    "\"model_rewrite\" is an optional improved version at the learner's level (not an advanced essay).",
    "Be honest about \"confidence\" (low / medium / high), give \"evidence\" and \"limitations\". Give \"level_evidence\" only when the text is long enough to judge; otherwise null. Never claim an official exam score.",
    revision ? "This is the learner's second version: also fill \"comparison\" with what improved and what still needs work." : "",
    `"grammar_point" may only be one of these ids (or null): ${points.map((p) => `${p.id} (${p.title})`).join(", ")}.`,
    `Reply with ONE JSON object only: {"task_completion":{"rating":"met|partly|not_met","comment_zh":string},"content":{"clear":boolean,"comment_zh":string},"grammar":[{"original":string,"corrected":string,"explanation_zh":string,"category":"${["word_form", "word_order", "tense", "agreement", "article", "preposition", "spelling", "collocation", "pragmatics", "comprehension", "task"].join("|")}","grammar_point":string|null,"severity":"high|medium|low"}],"vocabulary":[{"original":string,"suggestion":string,"explanation_zh":string}],"organization":{"comment_zh":string,"suggestions_zh":[string]},"natural_expressions":[{"original":string,"better":string,"note_zh":string}],"priorities":[string],"level_evidence":{"level":"Pre-A1|A1|A2|B1|B2|C1|C2","comment_zh":string}|null,"confidence":"low|medium|high","evidence":[string],"limitations":[string],"next_action":string,"model_rewrite":string|null,"comparison":{"improved":[string],"still_to_fix":[string]}|null}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function resolveTask(db: DbExecutor, userId: string, input: { promptId: string | null; custom?: { title: string; task: string } }): Promise<{ task: WritingTask; type: WritingType; promptId: string | null }> {
  if (input.promptId) {
    const p = loadWritingPrompts().find((x) => x.id === input.promptId);
    if (!p) throw new WritingNotFoundError(input.promptId);
    return {
      promptId: p.id,
      type: p.type,
      task: { title: p.title_zh, task: `${p.task_zh}\n${p.task_en}`, level: CEFR_LEVEL_LABELS[p.level], minWords: p.min_words, maxWords: p.max_words, checklist: p.checklist_zh },
    };
  }
  if (!input.custom?.task.trim()) throw new WritingRejectedError("custom task needs a description");
  const { level } = await learnerInputLevel(db, userId, "reading");
  return {
    promptId: null,
    type: "free",
    task: { title: input.custom.title.trim().slice(0, 80) || "自由写作", task: input.custom.task.trim().slice(0, 500), level: CEFR_LEVEL_LABELS[level], minWords: 20, maxWords: 300, checklist: [] },
  };
}

async function askFeedback(db: Database, userId: string, timeZone: string, task: WritingTask, explanation: string, texts: { original: string; revised?: string }, provider?: AIProvider | null) {
  const points = await grammarPointList(db);
  const revision = texts.revised !== undefined;
  const learnerText = revision ? texts.revised! : texts.original;
  const message = revision ? `FIRST VERSION:\n${texts.original}\n\nLEARNER TEXT (second version):\n${texts.revised}` : `LEARNER TEXT:\n${texts.original}`;
  const { value } = await runAI({ db, userId, task: "writing_feedback", timeZone, provider }, async (ai) => {
    const r = await ai.generateText({
      task: "writing_feedback",
      system: systemPrompt(task, explanation, points, revision),
      messages: [{ role: "user", content: message }],
      json: true,
      maxOutputTokens: Math.max(getEnv().AI_MAX_OUTPUT_TOKENS, 1500),
    });
    return { value: parseWritingFeedback(r.text, learnerText, new Set(points.map((p) => p.id))), usage: r.usage, model: r.model };
  });
  return { ...value, points };
}

/** Grammar problems the AI is reasonably sure about become error-notebook entries. */
async function recordWritingErrors(db: DbExecutor, userId: string, submissionId: string, feedback: WritingFeedback, points: { id: string; title: string }[]) {
  if (feedback.confidence === "low") return 0;
  let n = 0;
  for (const g of feedback.grammar.filter((x) => x.severity !== "low")) {
    const point = g.grammar_point ? points.find((p) => p.id === g.grammar_point) : undefined;
    await recordError(db, userId, {
      category: g.category as ErrorCategory,
      pointType: point ? "grammar" : "writing",
      pointId: point ? point.id : g.category,
      title: point ? point.title : `${ERROR_CATEGORY_LABELS[g.category as keyof typeof ERROR_CATEGORY_LABELS] ?? g.category}（写作）`,
      source: "writing",
      sourceRef: submissionId,
      wrong: g.original,
      correct: g.corrected,
    });
    n += 1;
  }
  return n;
}

/**
 * Writing level from AI feedback: only medium/high-confidence feedback that
 * gave level evidence counts; at least 3 such texts; median of the last 5.
 * Always stored with low confidence (spec §10.4: one model's judgement is not a level).
 */
export async function refreshWritingEstimate(db: DbExecutor, userId: string) {
  const rows = await db
    .select({ feedback: writingSubmissions.feedback, confidence: writingSubmissions.confidence })
    .from(writingSubmissions)
    .where(and(eq(writingSubmissions.userId, userId), eq(writingSubmissions.status, "feedback")))
    .orderBy(desc(writingSubmissions.createdAt))
    .limit(20);
  const levels = rows
    .filter((r) => r.confidence === "medium" || r.confidence === "high")
    .map((r) => (r.feedback as WritingFeedback | null)?.level_evidence?.level)
    .filter((l): l is NonNullable<typeof l> => Boolean(l))
    .slice(0, 5)
    .map((label) => CEFR_LEVELS.find((c) => CEFR_LEVEL_LABELS[c] === label)!)
    .sort((a, b) => CEFR_LEVELS.indexOf(a) - CEFR_LEVELS.indexOf(b));
  if (levels.length < 3) return null;
  const level: CefrLevel = levels[Math.floor((levels.length - 1) / 2)]!;
  const [last] = await db
    .select()
    .from(skillEstimates)
    .where(and(eq(skillEstimates.userId, userId), eq(skillEstimates.skill, "writing"), like(skillEstimates.source, "ai_writing%")))
    .orderBy(desc(skillEstimates.createdAt))
    .limit(1);
  if (last && last.estimatedLevel === level && last.evidenceCount === levels.length) return null;
  const [row] = await db
    .insert(skillEstimates)
    .values({ userId, skill: "writing", estimatedLevel: level, confidence: "low", evidenceCount: levels.length, source: "ai_writing", details: { levels } })
    .returning();
  return row!;
}

export type CreateWritingInput = { promptId: string | null; custom?: { title: string; task: string }; text: string };

/**
 * Save the text first (it is never lost), then ask for feedback. If the AI
 * fails, the draft stays and feedback can be requested again.
 */
export async function submitWriting(db: Database, userId: string, input: CreateWritingInput, provider?: AIProvider | null) {
  const id = await createWritingDraft(db, userId, input);
  await requestFeedback(db, userId, id, provider);
  return id;
}

/** Save the learner's text as a draft (step one of submitWriting; the UI keeps the id even if feedback fails). */
export async function createWritingDraft(db: Database, userId: string, input: CreateWritingInput) {
  const text = input.text.trim();
  if (countWords(text) < 5) throw new WritingRejectedError("too short");
  if (text.length > MAX_WRITING_CHARS) throw new WritingRejectedError("too long");
  const resolved = await resolveTask(db, userId, input);
  const [row] = await db
    .insert(writingSubmissions)
    .values({ userId, promptId: resolved.promptId, taskType: resolved.type, task: resolved.task, level: resolved.task.level, originalText: text, rubricVersion: RUBRIC_VERSION, status: "draft" })
    .returning({ id: writingSubmissions.id });
  return row!.id;
}

async function ownedSubmission(db: DbExecutor, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(writingSubmissions)
    .where(and(eq(writingSubmissions.id, id), eq(writingSubmissions.userId, userId)));
  if (!row) throw new WritingNotFoundError(id);
  return row;
}

/** Feedback on the first version (also used to retry after an AI failure). */
export async function requestFeedback(db: Database, userId: string, id: string, provider?: AIProvider | null) {
  const sub = await ownedSubmission(db, userId, id);
  if (sub.status !== "draft") return sub.feedback as WritingFeedback;
  const { profile } = await getLearnerSettings(db, userId);
  const { feedback, points } = await askFeedback(db, userId, profile.timezone, sub.task as WritingTask, profile.explanationLanguage, { original: sub.originalText }, provider);
  await db.update(writingSubmissions).set({ feedback, confidence: feedback.confidence, status: "feedback" }).where(eq(writingSubmissions.id, id));
  await recordWritingErrors(db, userId, id, feedback, points);
  await refreshWritingEstimate(db, userId);
  return feedback;
}

/** The learner's own second version, with feedback that compares it to the first. */
export async function reviseWriting(db: Database, userId: string, id: string, revisedText: string, provider?: AIProvider | null, now = new Date()) {
  const sub = await ownedSubmission(db, userId, id);
  if (sub.status === "draft") throw new WritingRejectedError("needs feedback first");
  const text = revisedText.trim();
  if (countWords(text) < 5 || text.length > MAX_WRITING_CHARS) throw new WritingRejectedError("bad length");
  const { profile } = await getLearnerSettings(db, userId);
  const { feedback } = await askFeedback(db, userId, profile.timezone, sub.task as WritingTask, profile.explanationLanguage, { original: sub.originalText, revised: text }, provider);
  await db.update(writingSubmissions).set({ revisedText: text, revisionFeedback: feedback, status: "revised", revisedAt: now }).where(eq(writingSubmissions.id, id));
  return feedback;
}

export async function getWriting(db: DbExecutor, userId: string, id: string) {
  const sub = await ownedSubmission(db, userId, id);
  return { ...sub, task: sub.task as WritingTask, feedback: sub.feedback as WritingFeedback | null, revisionFeedback: sub.revisionFeedback as WritingFeedback | null };
}

export async function listWritings(db: DbExecutor, userId: string) {
  return db
    .select({ id: writingSubmissions.id, task: writingSubmissions.task, taskType: writingSubmissions.taskType, status: writingSubmissions.status, confidence: writingSubmissions.confidence, createdAt: writingSubmissions.createdAt, originalText: writingSubmissions.originalText })
    .from(writingSubmissions)
    .where(eq(writingSubmissions.userId, userId))
    .orderBy(desc(writingSubmissions.createdAt))
    .limit(100);
}

export async function deleteWriting(db: DbExecutor, userId: string, id: string) {
  const deleted = await db
    .delete(writingSubmissions)
    .where(and(eq(writingSubmissions.id, id), eq(writingSubmissions.userId, userId)))
    .returning({ id: writingSubmissions.id });
  if (deleted.length === 0) throw new WritingNotFoundError(id);
}

