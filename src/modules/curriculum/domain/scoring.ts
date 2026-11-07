import { z } from "zod";

import type { LessonStepContent } from "../content/schema";

/**
 * Server-side answer checking. Answer keys never reach the browser; the client
 * sends a response and gets back the verdict, the correct answer and the
 * explanation (spec §2.3: show the right answer first, then a short reason).
 */

/**
 * Lenient comparison for typed English at beginner level: case, punctuation,
 * curly vs straight apostrophes and extra spaces are ignored; words are not.
 */
export function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/'/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const responseSchemas = {
  viewed: z.object({ viewed: z.literal(true) }),
  choice: z.object({ choice: z.number().int().min(0) }),
  cloze: z.object({ text: z.string().max(200) }),
  order: z.object({ tokens: z.array(z.string().max(60)).max(40) }),
  match: z.object({ pairs: z.array(z.object({ left: z.string(), right: z.string() })).max(10) }),
  speak: z.object({
    mode: z.enum(["voice", "text"]),
    text: z.string().max(1000).optional(),
    checked: z.array(z.number().int().min(0)).max(20),
  }),
  write: z.object({ text: z.string().min(1).max(2000), checked: z.array(z.number().int().min(0)).max(20) }),
} as const;

export type StepResponse =
  | z.infer<(typeof responseSchemas)["viewed"]>
  | z.infer<(typeof responseSchemas)["choice"]>
  | z.infer<(typeof responseSchemas)["cloze"]>
  | z.infer<(typeof responseSchemas)["order"]>
  | z.infer<(typeof responseSchemas)["match"]>
  | z.infer<(typeof responseSchemas)["speak"]>
  | z.infer<(typeof responseSchemas)["write"]>;

export type StepEvaluation = {
  /** true/false for objective steps; null for non-assessed steps and open tasks. */
  isCorrect: boolean | null;
  /** Share of rubric items the learner ticked (open tasks only). */
  selfScore: number | null;
  /** Human-readable correct answer (objective steps) or model answers (open tasks). */
  correctAnswer: string | null;
  modelAnswers: string[];
  explanation: string | null;
};

export class InvalidResponseError extends Error {}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new InvalidResponseError("Response does not match the step type.");
  return result.data;
}

const NOT_ASSESSED: StepEvaluation = {
  isCorrect: null,
  selfScore: null,
  correctAnswer: null,
  modelAnswers: [],
  explanation: null,
};

export function evaluateStep(step: LessonStepContent, response: unknown): StepEvaluation {
  switch (step.type) {
    case "orientation":
    case "dialogue":
    case "vocab":
    case "notice":
    case "teach":
      parse(responseSchemas.viewed, response);
      return NOT_ASSESSED;

    case "choice": {
      const { choice } = parse(responseSchemas.choice, response);
      if (choice >= step.options.length) throw new InvalidResponseError("Choice out of range.");
      return {
        isCorrect: choice === step.answer,
        selfScore: null,
        correctAnswer: step.options[step.answer]!,
        modelAnswers: [],
        explanation: step.explanation_zh,
      };
    }

    case "cloze": {
      const { text } = parse(responseSchemas.cloze, response);
      const given = normalizeAnswer(text);
      return {
        isCorrect: given.length > 0 && step.answers.some((a) => normalizeAnswer(a) === given),
        selfScore: null,
        correctAnswer: step.sentence_en.replace("___", step.answers[0]!),
        modelAnswers: [],
        explanation: step.explanation_zh,
      };
    }

    case "order": {
      const { tokens } = parse(responseSchemas.order, response);
      const given = normalizeAnswer(tokens.join(" "));
      return {
        isCorrect: step.answers.some((a) => normalizeAnswer(a) === given),
        selfScore: null,
        correctAnswer: step.answers[0]!,
        modelAnswers: [],
        explanation: step.explanation_zh,
      };
    }

    case "match": {
      const { pairs } = parse(responseSchemas.match, response);
      const expected = new Map(step.pairs.map((p) => [p.left, p.right]));
      const isCorrect = pairs.length === step.pairs.length && pairs.every((p) => expected.get(p.left) === p.right);
      return {
        isCorrect,
        selfScore: null,
        correctAnswer: step.pairs.map((p) => `${p.left} → ${p.right}`).join("；"),
        modelAnswers: [],
        explanation: null,
      };
    }

    case "speak":
    case "write": {
      const schema = step.type === "speak" ? responseSchemas.speak : responseSchemas.write;
      const { checked } = parse(schema, response);
      const valid = new Set(checked.filter((i) => i < step.checklist_zh.length));
      return {
        isCorrect: null,
        selfScore: valid.size / step.checklist_zh.length,
        correctAnswer: null,
        modelAnswers: step.model_answers,
        explanation: null,
      };
    }
  }
}
