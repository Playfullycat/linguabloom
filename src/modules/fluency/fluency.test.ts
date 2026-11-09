// @vitest-environment node
import { describe, expect, it } from "vitest";

import { retellCues, retellLimitsMs, roundGain, speedCounts, suggestKind, weeklyFluencyTarget, wordCountOf, wordsPerMinute } from "./domain/fluency";

describe("fluency helpers", () => {
  it("works out words per minute and word counts like the reader does", () => {
    expect(wordsPerMinute(120, 60_000)).toBe(120);
    expect(wordsPerMinute(90, 45_000)).toBe(120);
    expect(wordCountOf(["I'm Mia.", "I have 2 cats, and it's 7.30 now."])).toBe(10);
  });

  it("shrinks the retelling time 4/3/2-style, longer at higher levels", () => {
    expect(retellLimitsMs("a1")).toEqual([60_000, 45_000, 30_000]);
    expect(retellLimitsMs("b1")).toEqual([90_000, 60_000, 45_000]);
    expect(retellLimitsMs("c2")).toEqual([120_000, 90_000, 60_000]);
    for (const level of ["pre_a1", "a2", "b2"]) {
      const [a, b, c] = retellLimitsMs(level);
      expect(a > b && b > c).toBe(true);
    }
  });

  it("counts a speed only with about 70% understanding", () => {
    expect(speedCounts(3, 4)).toBe(true);
    expect(speedCounts(2, 4)).toBe(false);
    expect(speedCounts(null, null)).toBe(true); // a text without questions
  });

  it("gives retelling cues from the glossary in text order, else from long words", () => {
    const text = ["Tom gets up early.", "He drinks coffee and reads the newspaper.", "Then he walks to the station."];
    expect(retellCues(text, [{ text: "station" }, { text: "get up" }, { text: "newspaper" }, { text: "early" }, { text: "missing" }])).toEqual(["early", "newspaper", "station"]);
    const cues = retellCues(text, []);
    expect(cues).toEqual(["drinks", "coffee", "newspaper", "station"]);
  });

  it("aims for more fluency time at higher levels and rotates the activity", () => {
    expect(weeklyFluencyTarget(null)).toBe(10);
    expect(weeklyFluencyTarget("b1")).toBe(15);
    expect(weeklyFluencyTarget("c1")).toBe(20);
    expect(suggestKind("a1", {})).toBe("repeated_reading");
    expect(suggestKind("b1", {})).toBe("speed_reading");
    expect(suggestKind("b1", { speed_reading: 2, repeated_reading: 1 })).toBe("timed_retell");
  });

  it("reports how much faster the last round was", () => {
    expect(roundGain([{ ms: 60_000 }, { ms: 50_000 }, { ms: 45_000 }])).toBe(25);
    expect(roundGain([{ ms: 60_000 }])).toBeNull();
  });
});
