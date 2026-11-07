import { z } from "zod";

import { normalizeAnswer } from "../../curriculum/domain/scoring";
import type { ExerciseContent, ExerciseType } from "../content";

/**
 * Exercise prompts (what the browser sees), answer keys (server only) and
 * scoring. Typed answers are compared after normalising case, punctuation
 * and apostrophes, so "Im busy" and "I'm busy." both count.
 */

export type ExercisePrompt =
  | { type: "choice"; prompt_zh?: string; prompt_en?: string; options: string[] }
  | { type: "cloze"; instructions_zh?: string; sentence_en: string; translation_zh: string }
  | { type: "order"; translation_zh: string; tokens: string[] }
  | { type: "correction"; wrong_en: string; translation_zh?: string }
  | { type: "build"; task_zh: string; checklist_zh: string[] };

export type AnswerKey = { answer: number } | { answers: string[] } | { model_answers: string[] };

export function splitExercise(e: ExerciseContent): { prompt: ExercisePrompt; key: AnswerKey; scoringRule: "exact" | "normalized" | "self" } {
  switch (e.type) {
    case "choice":
      return { prompt: { type: "choice", prompt_zh: e.prompt_zh, prompt_en: e.prompt_en, options: e.options }, key: { answer: e.answer }, scoringRule: "exact" };
    case "cloze":
      return { prompt: { type: "cloze", instructions_zh: e.instructions_zh, sentence_en: e.sentence_en, translation_zh: e.translation_zh }, key: { answers: e.answers }, scoringRule: "normalized" };
    case "order":
      return { prompt: { type: "order", translation_zh: e.translation_zh, tokens: e.tokens }, key: { answers: e.answers }, scoringRule: "normalized" };
    case "correction":
      return { prompt: { type: "correction", wrong_en: e.wrong_en, translation_zh: e.translation_zh }, key: { answers: e.answers }, scoringRule: "normalized" };
    case "build":
      return { prompt: { type: "build", task_zh: e.task_zh, checklist_zh: e.checklist_zh }, key: { model_answers: e.model_answers }, scoringRule: "self" };
  }
}

export class InvalidExerciseResponseError extends Error {}

export const exerciseResponseSchemas = {
  choice: z.object({ choice: z.number().int().min(0).max(10) }),
  cloze: z.object({ text: z.string().max(200) }),
  order: z.object({ tokens: z.array(z.string().max(40)).max(30) }),
  correction: z.object({ text: z.string().max(300) }),
  build: z.object({ text: z.string().max(1000), checked: z.array(z.boolean()).max(4) }),
} satisfies Record<ExerciseType, z.ZodTypeAny>;

export type ExerciseEvaluation = {
  isCorrect: boolean | null;
  score: number;
  /** What to show as the right answer (the full sentence where it helps). */
  correctAnswer: string | null;
  modelAnswers: string[];
  /** Normalised learner answer, for the error notebook. */
  given: string;
};

const matches = (given: string, answers: string[]) => {
  const g = normalizeAnswer(given);
  return g.length > 0 && answers.some((a) => normalizeAnswer(a) === g);
};

export function scoreExercise(prompt: ExercisePrompt, key: AnswerKey, response: unknown): ExerciseEvaluation {
  const parsed = exerciseResponseSchemas[prompt.type].safeParse(response);
  if (!parsed.success) throw new InvalidExerciseResponseError("Response does not match the exercise type.");
  const r = parsed.data as Record<string, unknown>;
  switch (prompt.type) {
    case "choice": {
      const choice = r.choice as number;
      if (choice >= prompt.options.length) throw new InvalidExerciseResponseError("Choice out of range.");
      const answer = (key as { answer: number }).answer;
      const ok = choice === answer;
      return { isCorrect: ok, score: ok ? 1 : 0, correctAnswer: prompt.options[answer]!, modelAnswers: [], given: prompt.options[choice]! };
    }
    case "cloze": {
      const answers = (key as { answers: string[] }).answers;
      const ok = matches(r.text as string, answers);
      return { isCorrect: ok, score: ok ? 1 : 0, correctAnswer: prompt.sentence_en.replace("___", answers[0]!), modelAnswers: [], given: prompt.sentence_en.replace("___", (r.text as string).trim() || "…") };
    }
    case "order":
    case "correction": {
      const answers = (key as { answers: string[] }).answers;
      const given = prompt.type === "order" ? (r.tokens as string[]).join(" ") : (r.text as string);
      const ok = matches(given, answers);
      return { isCorrect: ok, score: ok ? 1 : 0, correctAnswer: answers[0]!, modelAnswers: answers.slice(1), given: given.trim() };
    }
    case "build": {
      const checked = r.checked as boolean[];
      const share = prompt.checklist_zh.length === 0 ? 0 : checked.slice(0, prompt.checklist_zh.length).filter(Boolean).length / prompt.checklist_zh.length;
      return { isCorrect: null, score: Math.round(share * 100) / 100, correctAnswer: null, modelAnswers: (key as { model_answers: string[] }).model_answers, given: (r.text as string).trim() };
    }
  }
}
