// @vitest-environment node
import { describe, expect, it } from "vitest";

import { MockProvider } from "@/modules/ai/provider/mock";

import { PRACTICE_CODES, TASK_CODES, audioScript, hiwTokens, learnerView, loadPte, seededOrder, type Prompt } from "./content";
import { parsePteWrittenFeedback } from "./domain/feedback";
import { ResponseShapeError, scoreAdjacentPairs, scoreDictation, scoreMultiple, scoreObjective, sstForm } from "./domain/scoring";

const { versions, prompts } = loadPte();
const prompt = (id: string) => prompts.find((p) => p.id === id)! as Prompt;

describe("PTE content", () => {
  it("has one current version with all 22 official task types and its sources", () => {
    const current = versions.filter((v) => v.is_current);
    expect(current).toHaveLength(1);
    expect(current[0]!.task_types.map((t) => t.code).sort()).toEqual([...TASK_CODES].sort());
    expect(current[0]!.sources.every((s) => s.url.startsWith("https://www.pearsonpte.com/"))).toBe(true);
    expect(current[0]!.reviewed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const sections = current[0]!.task_types.reduce<Record<string, number>>((m, t) => ({ ...m, [t.section]: (m[t.section] ?? 0) + 1 }), {});
    expect(sections).toEqual({ speaking_writing: 9, reading: 5, listening: 8 });
  });

  it("every practisable type has at least 3 original prompts", () => {
    for (const code of PRACTICE_CODES) expect(prompts.filter((p) => p.task === code).length).toBeGreaterThanOrEqual(3);
  });

  it("the learner view never contains answers or listening scripts", () => {
    for (const p of prompts) {
      const view = JSON.stringify(learnerView(p));
      expect(view).not.toMatch(/"answers?"|explanation_zh|model_summary|key_points/);
      const script = audioScript(p);
      if (script && p.task !== "l_fib_type" && p.task !== "l_hiw") expect(view).not.toContain(script.slice(0, 40));
    }
    // Typed blanks: the words to fill in are not in the view.
    const fib = JSON.stringify(learnerView(prompt("pte-l-fib-01")));
    expect(fib).not.toContain("Tuesday");
  });

  it("highlight-incorrect transcripts really differ from the audio", () => {
    for (const p of prompts.filter((x) => x.task === "l_hiw")) {
      const { tokens, incorrect, spoken } = hiwTokens((p.content as { transcript: string }).transcript);
      expect(incorrect.length).toBeGreaterThanOrEqual(2);
      for (const i of incorrect) expect(spoken.split(/\W+/)).not.toContain(tokens[i]!.text);
    }
  });

  it("shuffles deterministically and never shows a reorder task already solved", () => {
    expect(seededOrder(4, "x")).toEqual(seededOrder(4, "x"));
    for (const p of prompts.filter((x) => x.task === "r_reorder")) {
      const order = seededOrder((p.content as { items: string[] }).items.length, p.id);
      expect(order.every((v, i) => v === i)).toBe(false);
    }
  });
});

describe("objective scoring", () => {
  it("fill in the blanks (dropdown): one point per blank", () => {
    const p = prompt("pte-r-fib-dd-01");
    expect(scoreObjective(p, { kind: "choices", choices: [0, 1, 1, 0] })).toMatchObject({ score: 4, maxScore: 4 });
    const partial = scoreObjective(p, { kind: "choices", choices: [0, 0, null, 0] })!;
    expect(partial).toMatchObject({ score: 2, maxScore: 4 });
    expect(partial.marks[1]).toMatchObject({ correct: false, given: "raises", expected: "reduces" });
    expect(partial.marks[2]).toMatchObject({ correct: false, given: null });
  });

  it("multiple answers: +1 right, −1 wrong, never below zero", () => {
    expect(scoreMultiple([0, 2, 4], [0, 2, 4], ["a", "b", "c", "d", "e"]).score).toBe(3);
    expect(scoreMultiple([0, 1, 2], [0, 2, 4], ["a", "b", "c", "d", "e"]).score).toBe(1);
    expect(scoreMultiple([1, 3], [0, 2, 4], ["a", "b", "c", "d", "e"]).score).toBe(0);
    // Choosing everything is not a strategy.
    expect(scoreMultiple([0, 1, 2, 3, 4], [0, 2, 4], ["a", "b", "c", "d", "e"]).score).toBe(1);
  });

  it("re-order: one point per correct neighbouring pair, through the shuffled display ids", () => {
    expect(scoreAdjacentPairs([0, 1, 2, 3], 4).score).toBe(3);
    expect(scoreAdjacentPairs([3, 2, 1, 0], 4).score).toBe(0);
    expect(scoreAdjacentPairs([1, 2, 3, 0], 4).score).toBe(2);
    const p = prompt("pte-r-reorder-01");
    const view = learnerView(p) as { items: { id: string; text: string }[] };
    const items = (p.content as { items: string[] }).items;
    const correct = items.map((t) => view.items.find((v) => v.text === t)!.id);
    expect(scoreObjective(p, { kind: "order", order: correct })).toMatchObject({ score: 3, maxScore: 3 });
    expect(() => scoreObjective(p, { kind: "order", order: correct.slice(0, 2) })).toThrow(ResponseShapeError);
  });

  it("drag and drop and typed blanks; typed accepts alternatives and ignores case", () => {
    expect(scoreObjective(prompt("pte-r-fib-drag-01"), { kind: "words", words: ["energy", "decide", "rely"] })).toMatchObject({ score: 2, maxScore: 3 });
    expect(scoreObjective(prompt("pte-l-fib-03"), { kind: "words", words: ["Stage", "analyzed", "relativly", "survey"] })).toMatchObject({ score: 3, maxScore: 4 });
  });

  it("highlight incorrect words: −1 for each wrong pick", () => {
    const p = prompt("pte-l-hiw-01");
    const { tokens, incorrect } = hiwTokens((p.content as { transcript: string }).transcript);
    expect(scoreObjective(p, { kind: "selected", selected: incorrect })).toMatchObject({ score: 3, maxScore: 3 });
    const wrongWord = tokens.findIndex((t, i) => t.word && !incorrect.includes(i));
    expect(scoreObjective(p, { kind: "selected", selected: [incorrect[0]!, wrongWord] })).toMatchObject({ score: 0 });
    expect(scoreObjective(p, { kind: "selected", selected: [incorrect[0]!, incorrect[1]!, wrongWord] })).toMatchObject({ score: 1 });
  });

  it("write from dictation: one point per correctly spelled word, punctuation and case ignored", () => {
    expect(scoreDictation("the library will be closed on sunday for repairs", "The library will be closed on Sunday for repairs.")).toMatchObject({ score: 9, maxScore: 9 });
    expect(scoreDictation("The libary will closed on Sunday for repairs", "The library will be closed on Sunday for repairs.").score).toBe(7);
    // A word only counts as often as it appears in the sentence.
    expect(scoreDictation("the the the", "The cat saw the dog.").score).toBe(2);
  });

  it("single-answer types are right or wrong; a response of the wrong shape is rejected", () => {
    expect(scoreObjective(prompt("pte-l-smw-01"), { kind: "choice", choice: 1 })).toMatchObject({ score: 1, maxScore: 1 });
    expect(scoreObjective(prompt("pte-l-smw-01"), { kind: "choice", choice: null })).toMatchObject({ score: 0 });
    expect(() => scoreObjective(prompt("pte-r-mcsa-01"), { kind: "text", text: "1" })).toThrow(ResponseShapeError);
    expect(scoreObjective(prompt("pte-l-sst-01"), { kind: "text", text: "x" })).toBeNull();
  });

  it("summarize spoken text form: 50–70 words, zero outside 40–100", () => {
    const w = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    expect(sstForm(w(55)).status).toBe("ok");
    expect(sstForm(w(45)).status).toBe("outside_target");
    expect(sstForm(w(101)).status).toBe("zero");
    expect(sstForm(w(39)).status).toBe("zero");
  });
});

describe("AI-assisted feedback", () => {
  it("drops invented corrections and is never more than medium confidence", async () => {
    const text = "The speaker say that city bees produce honey. Farms use chemicals that harm insects and recieve less benefit.";
    const r = await new MockProvider().generateText({ task: "pte_feedback", system: "", messages: [{ role: "user", content: `TRANSCRIPT:\nx\n\nSUMMARY:\n${text}` }], json: true, maxOutputTokens: 500 });
    const f = parsePteWrittenFeedback(r.text, text);
    expect(f.confidence).toBe("medium");
    expect(f.spelling.errors).toEqual([{ wrong: "recieve", right: "receive" }]);
    expect(f.not_official_zh).toContain("不是 Pearson 的评分");
    const invented = parsePteWrittenFeedback(JSON.stringify({ ...JSON.parse(r.text), grammar: { comment_zh: "x", issues: [{ original: "I goed home", corrected: "I went home" }] }, spelling: { errors: [{ wrong: "teh", right: "the" }] } }), text);
    expect(invented.grammar.issues).toEqual([]);
    expect(invented.spelling.errors).toEqual([]);
  });
});
