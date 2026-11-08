// @vitest-environment node
import { describe, expect, it } from "vitest";

import { loadMaterials } from "./content";
import { checkDictation, difficultyOf, tokenize } from "./domain/text";

describe("built-in materials", () => {
  it("all validate, with every glossary word present in the text", () => {
    const materials = loadMaterials();
    expect(materials.length).toBe(16);
    for (const level of ["pre_a1", "a1", "a2", "b1"]) {
      for (const type of ["reading", "listening"]) {
        expect(materials.filter((m) => m.level === level && m.type === type).length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("text helpers", () => {
  const glossary = [
    { key: "get-up", text: "get up", pos: "phrasal verb", zh: "起床" },
    { key: "get", text: "get", forms: ["gets"], pos: "verb", zh: "得到" },
  ];

  it("tokenizes into tappable words, preferring multi-word chunks", () => {
    const tokens = tokenize("I get up at six, and he gets coffee.", glossary);
    const wordsOnly = tokens.filter((t) => t.kind === "word");
    expect(wordsOnly.map((t) => t.text)).toEqual(["I", "get up", "at", "six", "and", "he", "gets", "coffee"]);
    expect(wordsOnly.find((t) => t.text === "get up")!.gloss).toBe("get-up");
    expect(wordsOnly.find((t) => t.text === "gets")!.gloss).toBe("get");
    expect(tokens.map((t) => t.text).join("")).toBe("I get up at six, and he gets coffee.");
  });

  it("computes difficulty numbers", () => {
    const d = difficultyOf(["I get up early.", "He gets tea."], glossary);
    expect(d).toMatchObject({ wordCount: 7, sentenceCount: 2, glossaryCount: 2, longestSentence: 4 });
    expect(d.glossaryDensity).toBeCloseTo(3 / 7, 2);
  });

  it("checks dictation word by word", () => {
    expect(checkDictation("I'm fine, thank you.", "im fine thank you").isCorrect).toBe(true);
    const r = checkDictation("They're two pounds a kilo.", "there two pound a kilo please");
    expect(r.isCorrect).toBe(false);
    expect(r.words.map((w) => w.status)).toEqual(["wrong", "ok", "wrong", "ok", "ok"]);
    expect(r.extra).toEqual(["please"]);
    expect(checkDictation("See you in class!", "see you").words.map((w) => w.status)).toEqual(["ok", "ok", "missing", "missing"]);
  });
});
