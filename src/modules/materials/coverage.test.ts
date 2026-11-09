// @vitest-environment node
import { describe, expect, it } from "vitest";

import { loadMaterials } from "./content";
import { coverageBand, lemmaCandidates, levelLexicon, textCoverage, withWords } from "./domain/coverage";
import { loadWordBands } from "./wordlist";

describe("known-word coverage", () => {
  it("finds dictionary forms: inflections, irregulars, derivations, prefixes", () => {
    expect(lemmaCandidates("walked")).toContain("walk");
    expect(lemmaCandidates("studies")).toContain("study");
    expect(lemmaCandidates("running")).toContain("run");
    expect(lemmaCandidates("went")).toContain("go");
    expect(lemmaCandidates("children")).toContain("child");
    expect(lemmaCandidates("findings")).toContain("find");
    expect(lemmaCandidates("thoughtfully")).toContain("think");
    expect(lemmaCandidates("fairness")).toContain("fair");
    expect(lemmaCandidates("uncomfortable")).toContain("comfort");
    expect(lemmaCandidates("travellers")).toContain("travel");
    expect(lemmaCandidates("fully")).toContain("full");
    expect(lemmaCandidates("Tom's")).toContain("tom");
  });

  it("counts running words, skipping names and numbers", () => {
    const lexicon = withWords(new Set(), ["I live in a small town"]);
    const c = textCoverage(["I live in Leeds.", "It is a small town of 2,000 people."], lexicon);
    // "Leeds" (a name) and "2,000" are not counted; "it", "is", "of" and "people" are unknown here.
    expect(c.total).toBe(10);
    expect(c.known).toBe(6);
    expect(c.unknown.sort()).toEqual(["is", "it", "of", "people"]);
    // The first word of each sentence is not taken for a name.
    expect(textCoverage(["Hello there. Then we left."], withWords(new Set(), ["hello there then we left"])).ratio).toBe(1);
  });

  it("bands the ratio like the reading research: 98% extensive, 95% intensive", () => {
    expect(coverageBand(0.99)).toBe("extensive");
    expect(coverageBand(0.98)).toBe("extensive");
    expect(coverageBand(0.96)).toBe("intensive");
    expect(coverageBand(0.9)).toBe("hard");
  });

  it("treats a text's glossary words as new at its own level and known above it", () => {
    const sources = [{ level: "a1", texts: ["The kitten sleeps in a basket."], glossary: ["kitten", "basket"] }];
    const atA1 = levelLexicon(sources, "a1");
    const atA2 = levelLexicon(sources, "a2");
    expect(atA1.has("sleep")).toBe(true);
    expect(atA1.has("kitten")).toBe(false);
    expect(atA2.has("kitten")).toBe(true);
    expect(levelLexicon(sources, "pre_a1").has("sleep")).toBe(false);
  });

  it("word bands load once per word, and higher learners know more of every built-in text", () => {
    const bands = loadWordBands();
    const all = Object.values(bands).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBeGreaterThan(2500);

    const materials = loadMaterials();
    const sources = materials.map((m) => ({ level: m.level, texts: m.segments.map((s) => s.en), glossary: m.glossary.map((g) => g.text) }));
    const text = materials.find((m) => m.id === "rd-b1-screens-sleep")!.segments.map((s) => s.en);
    const ratios = ["a1", "a2", "b1", "b2"].map((level) => textCoverage(text, levelLexicon(sources, level, bands)).ratio);
    expect([...ratios].sort((a, b) => a - b)).toEqual(ratios);
    expect(ratios[0]).toBeLessThan(0.95); // two levels below: many new words
    expect(ratios[2]).toBeGreaterThanOrEqual(0.95); // at its level, with the glossary as support
  });
});
