import { describe, expect, it } from "vitest";

import { SESSION_LENGTHS, getSessionTemplate, isSessionLength } from "./session-templates";

describe("session templates (spec §2.9)", () => {
  it.each(SESSION_LENGTHS)("%i-minute blocks add up to the session length", (length) => {
    const total = getSessionTemplate(length).reduce((sum, block) => sum + block.minutes, 0);
    expect(total).toBe(length);
  });

  it.each(SESSION_LENGTHS)("%i-minute session starts with due reviews (spec §4.3 priority)", (length) => {
    expect(getSessionTemplate(length)[0]?.kind).toBe("review");
  });

  it("matches the documented composition", () => {
    const kinds = (length: (typeof SESSION_LENGTHS)[number]) => getSessionTemplate(length).map((b) => b.kind);
    expect(kinds(15)).toEqual(["review", "input"]);
    expect(kinds(25)).toEqual(["review", "lesson"]);
    expect(kinds(40)).toEqual(["review", "lesson", "output"]);
    expect(kinds(60)).toEqual(["review", "lesson", "input", "output"]);
  });

  it("validates lengths", () => {
    expect(isSessionLength(25)).toBe(true);
    expect(isSessionLength(30)).toBe(false);
    expect(isSessionLength("25")).toBe(false);
  });
});
