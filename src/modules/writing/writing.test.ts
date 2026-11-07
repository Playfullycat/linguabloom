// @vitest-environment node
import { describe, expect, it } from "vitest";

import { AIError } from "../ai/provider/errors";

import { countWords, loadWritingPrompts } from "./content";
import { diffWords } from "./domain/diff";
import { parseWritingFeedback } from "./domain/feedback";

const base = {
  task_completion: { rating: "met", comment_zh: "ok" },
  content: { clear: true, comment_zh: "ok" },
  grammar: [],
  vocabulary: [],
  organization: { comment_zh: "ok", suggestions_zh: [] },
  natural_expressions: [],
  priorities: [],
  level_evidence: null,
  confidence: "medium",
  evidence: [],
  limitations: [],
  next_action: "write more",
  model_rewrite: null,
  comparison: null,
};

describe("writing feedback validation", () => {
  const text = "I very busy. She go to school. I like tea.";

  it("keeps only problems that quote the learner's words, most serious first", () => {
    const { feedback, dropped } = parseWritingFeedback(
      JSON.stringify({
        ...base,
        grammar: [
          { original: "She go to school.", corrected: "She goes to school.", explanation_zh: "-s", category: "agreement", grammar_point: "present-simple", severity: "medium" },
          { original: "i  VERY busy.", corrected: "I am very busy.", explanation_zh: "be", category: "agreement", grammar_point: "invented-point", severity: "high" },
          { original: "They was late.", corrected: "They were late.", explanation_zh: "x", category: "agreement", grammar_point: null, severity: "high" },
          { original: "I like tea.", corrected: "I like tea.", explanation_zh: "same", category: "word_form", grammar_point: null, severity: "low" },
        ],
        vocabulary: [{ original: "coffee", suggestion: "tea", explanation_zh: "x" }],
      }),
      text,
      new Set(["present-simple", "be-verb"]),
    );
    expect(feedback.grammar.map((g) => [g.corrected, g.grammar_point])).toEqual([
      ["I am very busy.", null], // unknown point → null, high severity first
      ["She goes to school.", "present-simple"],
    ]);
    expect(feedback.vocabulary).toEqual([]);
    expect(dropped).toBe(3);
  });

  it("tolerates fences and unknown categories, rejects broken replies", () => {
    const { feedback } = parseWritingFeedback(
      "```json\n" + JSON.stringify({ ...base, grammar: [{ original: "She go to school.", corrected: "She goes to school.", explanation_zh: "x", category: "made-up", severity: "urgent" }] }) + "\n```",
      text,
      new Set(),
    );
    expect(feedback.grammar[0]).toMatchObject({ category: "word_form", severity: "medium" });
    expect(() => parseWritingFeedback("{}", text, new Set())).toThrow(AIError);
    expect(() => parseWritingFeedback(JSON.stringify({ ...base, confidence: "certain" }), text, new Set())).toThrow(AIError);
  });
});

describe("writing helpers", () => {
  it("loads the built-in prompts", () => {
    const prompts = loadWritingPrompts();
    expect(prompts.length).toBeGreaterThanOrEqual(10);
    expect(new Set(prompts.map((p) => p.level))).toEqual(new Set(["a1", "a2", "b1"]));
  });

  it("counts words and diffs two versions word by word", () => {
    expect(countWords("I'm fine, thank you. 3 cats!")).toBe(6);
    expect(diffWords("I very busy today.", "I am very busy today.")).toEqual([
      { type: "same", text: "I " },
      { type: "added", text: "am " },
      { type: "same", text: "very busy today." },
    ]);
    expect(diffWords("She go home.", "She goes home.").filter((p) => p.type !== "same").map((p) => [p.type, p.text])).toEqual([
      ["removed", "go"],
      ["added", "goes"],
    ]);
  });
});
