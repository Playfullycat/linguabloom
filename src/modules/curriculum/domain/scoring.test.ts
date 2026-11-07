// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { LessonStepContent } from "../content/schema";
import { deterministicShuffle, toClientStep } from "./client-step";
import { InvalidResponseError, evaluateStep, normalizeAnswer } from "./scoring";

const base = { role: "guided_practice", skill: "grammar" } as const;

const choice: LessonStepContent = {
  ...base,
  id: "s01",
  type: "choice",
  prompt_zh: "?",
  options: ["A", "B", "C"],
  answer: 1,
  explanation_zh: "because",
};
const cloze: LessonStepContent = {
  ...base,
  id: "s02",
  type: "cloze",
  instructions_zh: "fill",
  sentence_en: "You're ___.",
  translation_zh: "不客气。",
  answers: ["welcome"],
  explanation_zh: "why",
};
const order: LessonStepContent = {
  ...base,
  id: "s03",
  type: "order",
  instructions_zh: "order",
  translation_zh: "我挺好的，谢谢。",
  tokens: ["good", "I'm", "thanks"],
  answers: ["I'm good, thanks."],
  explanation_zh: "why",
};
const match: LessonStepContent = {
  ...base,
  id: "s04",
  type: "match",
  instructions_zh: "match",
  pairs: [
    { left: "a", right: "1" },
    { left: "b", right: "2" },
  ],
};
const speak: LessonStepContent = {
  ...base,
  id: "s05",
  type: "speak",
  task_zh: "say bye",
  model_answers: ["Bye!"],
  checklist_zh: ["one", "two", "three", "four"],
};

describe("normalizeAnswer", () => {
  it("ignores case, punctuation, apostrophe style and spacing", () => {
    expect(normalizeAnswer("  I’m GOOD,   thanks! ")).toBe(normalizeAnswer("I'm good thanks"));
  });
  it("keeps words that differ", () => {
    expect(normalizeAnswer("good morning")).not.toBe(normalizeAnswer("good evening"));
  });
});

describe("evaluateStep", () => {
  it("scores choice and returns the right option with the explanation", () => {
    expect(evaluateStep(choice, { choice: 1 })).toMatchObject({ isCorrect: true, correctAnswer: "B", explanation: "because" });
    expect(evaluateStep(choice, { choice: 0 }).isCorrect).toBe(false);
  });

  it("accepts cloze answers leniently but not empty ones", () => {
    expect(evaluateStep(cloze, { text: " Welcome " }).isCorrect).toBe(true);
    expect(evaluateStep(cloze, { text: "" }).isCorrect).toBe(false);
    expect(evaluateStep(cloze, { text: "welcom" }).correctAnswer).toBe("You're welcome.");
  });

  it("checks token order", () => {
    expect(evaluateStep(order, { tokens: ["I'm", "good", "thanks"] }).isCorrect).toBe(true);
    expect(evaluateStep(order, { tokens: ["good", "I'm", "thanks"] }).isCorrect).toBe(false);
  });

  it("requires every match pair to be right", () => {
    expect(evaluateStep(match, { pairs: [{ left: "a", right: "1" }, { left: "b", right: "2" }] }).isCorrect).toBe(true);
    expect(evaluateStep(match, { pairs: [{ left: "a", right: "2" }, { left: "b", right: "1" }] }).isCorrect).toBe(false);
    expect(evaluateStep(match, { pairs: [{ left: "a", right: "1" }] }).isCorrect).toBe(false);
  });

  it("turns the self-check into a score for open tasks and returns model answers", () => {
    const result = evaluateStep(speak, { mode: "text", text: "Bye", checked: [0, 1, 1, 9] });
    expect(result).toMatchObject({ isCorrect: null, selfScore: 0.5, modelAnswers: ["Bye!"] });
  });

  it("rejects responses that do not fit the step type", () => {
    expect(() => evaluateStep(choice, { text: "B" })).toThrow(InvalidResponseError);
    expect(() => evaluateStep(choice, { choice: 7 })).toThrow(InvalidResponseError);
    expect(() => evaluateStep(order, { viewed: true })).toThrow(InvalidResponseError);
  });
});

describe("client steps", () => {
  it("never include answer keys", () => {
    for (const step of [choice, cloze, order, match]) {
      const json = JSON.stringify(toClientStep(step, "seed"));
      expect(json).not.toMatch(/"answer"|"answers"|"explanation_zh"|"pairs"/);
    }
  });

  it("shuffle deterministically and never keep the original order", () => {
    const items = ["a", "b", "c", "d"];
    expect(deterministicShuffle(items, "x")).toEqual(deterministicShuffle(items, "x"));
    expect(deterministicShuffle(items, "x")).not.toEqual(items);
    expect([...deterministicShuffle(items, "y")].sort()).toEqual(items);
  });
});
