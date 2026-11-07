// @vitest-environment node
import { describe, expect, it } from "vitest";

import { estimateFromAttempts } from "../../assessment/services/practice-estimates";
import { InvalidExerciseResponseError, scoreExercise, splitExercise } from "./scoring";

describe("exercise scoring", () => {
  it("keeps answer keys out of the prompt", () => {
    const { prompt, key, scoringRule } = splitExercise({ id: "e1", type: "correction", difficulty: 2, explanation_zh: "x", wrong_en: "She are here.", answers: ["She's here.", "She is here."] });
    expect(JSON.stringify(prompt)).not.toContain("She's here");
    expect(key).toEqual({ answers: ["She's here.", "She is here."] });
    expect(scoringRule).toBe("normalized");
  });

  it("scores choice, cloze, order, correction and self-assessed building", () => {
    const choice = splitExercise({ id: "e1", type: "choice", difficulty: 1, explanation_zh: "x", prompt_en: "I ___ here.", options: ["am", "is"], answer: 0 });
    expect(scoreExercise(choice.prompt, choice.key, { choice: 1 })).toMatchObject({ isCorrect: false, correctAnswer: "am", given: "is" });
    const cloze = splitExercise({ id: "e2", type: "cloze", difficulty: 1, explanation_zh: "x", sentence_en: "We ___ late.", translation_zh: "我们迟到了。", answers: ["are"] });
    expect(scoreExercise(cloze.prompt, cloze.key, { text: " ARE " })).toMatchObject({ isCorrect: true, correctAnswer: "We are late." });
    expect(scoreExercise(cloze.prompt, cloze.key, { text: "" }).isCorrect).toBe(false);
    const order = splitExercise({ id: "e3", type: "order", difficulty: 1, explanation_zh: "x", translation_zh: "你好吗", tokens: ["you", "How", "are"], answers: ["How are you?"] });
    expect(scoreExercise(order.prompt, order.key, { tokens: ["How", "are", "you"] }).isCorrect).toBe(true);
    expect(scoreExercise(order.prompt, order.key, { tokens: ["are", "How", "you"] }).isCorrect).toBe(false);
    const fix = splitExercise({ id: "e4", type: "correction", difficulty: 2, explanation_zh: "x", wrong_en: "I very busy.", answers: ["I'm very busy.", "I am very busy."] });
    expect(scoreExercise(fix.prompt, fix.key, { text: "Im very busy" }).isCorrect).toBe(true);
    const build = splitExercise({ id: "e5", type: "build", difficulty: 2, task_zh: "写一句", model_answers: ["I can swim."], checklist_zh: ["a", "b"] });
    expect(scoreExercise(build.prompt, build.key, { text: "I can cook.", checked: [true, false] })).toMatchObject({ isCorrect: null, score: 0.5, modelAnswers: ["I can swim."] });
    expect(() => scoreExercise(choice.prompt, choice.key, { text: "am" })).toThrow(InvalidExerciseResponseError);
    expect(() => scoreExercise(choice.prompt, choice.key, { choice: 5 })).toThrow(InvalidExerciseResponseError);
  });
});

describe("practice estimates", () => {
  const many = (level: string, correct: number, total: number) => Array.from({ length: total }, (_, i) => ({ level, isCorrect: i < correct }));

  it("needs enough evidence and picks the highest level passed", () => {
    expect(estimateFromAttempts(many("a1", 7, 7))).toBeNull();
    expect(estimateFromAttempts([...many("a1", 5, 5), ...many("a2", 3, 4)])).toMatchObject({ level: "a2", confidence: "low", evidenceCount: 9 });
    expect(estimateFromAttempts([...many("a1", 5, 5), ...many("a2", 1, 4)])!.level).toBe("a1");
    expect(estimateFromAttempts(many("a1", 2, 10))!.level).toBe("a1"); // lowest level practised
    expect(estimateFromAttempts([...many("a1", 20, 20), ...many("a2", 18, 20)])).toMatchObject({ confidence: "high", level: "a2" });
  });
});
