// @vitest-environment node
import { describe, expect, it } from "vitest";

import { CEFR_LEVELS } from "../domain/cefr";
import { loadContent } from "./load";
import { unitFileSchema } from "./schema";

describe("course content files", () => {
  it("all validate and cross-reference correctly", () => {
    expect(() => loadContent()).not.toThrow();
  });

  it("cover the spec's first-release catalog (§15.1)", () => {
    const { catalog } = loadContent();
    const count = (level: string) => catalog.units.filter((u) => u.level === level).length;
    expect(count("pre_a1")).toBeGreaterThanOrEqual(8);
    expect(count("a1")).toBeGreaterThanOrEqual(20);
    for (const level of CEFR_LEVELS) expect(count(level), level).toBeGreaterThan(0);
  });

  it("only links full content to Pre-A1 / A1 for now; higher levels stay planned", () => {
    const { catalog } = loadContent();
    const withFiles = catalog.units.filter((u) => u.file).map((u) => u.level);
    expect(withFiles.every((l) => l === "pre_a1" || l === "a1")).toBe(true);
  });

  it("every published lesson has objectives and an exit ticket, every objective item has an answer", () => {
    const { units } = loadContent();
    for (const file of units.values()) {
      for (const lesson of file.unit.lessons) {
        expect(lesson.objectives.length, lesson.id).toBeGreaterThanOrEqual(2);
        expect(lesson.steps.some((s) => s.role === "exit_ticket"), lesson.id).toBe(true);
        for (const step of lesson.steps) {
          if (step.type === "cloze" || step.type === "order") expect(step.answers.length).toBeGreaterThan(0);
          if (step.type === "speak" || step.type === "write") expect(step.checklist_zh.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("rejects a published unit without a review lesson or output task", () => {
    const { units } = loadContent();
    const sample = structuredClone([...units.values()][0]!);
    sample.unit.lessons = sample.unit.lessons.filter((l) => l.kind === "core");
    const result = unitFileSchema.safeParse(sample);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes("unit review"))).toBe(true);
  });

  it("order-step answers can be built from their tokens", () => {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
    const { units } = loadContent();
    for (const file of units.values()) {
      for (const lesson of file.unit.lessons) {
        for (const step of lesson.steps) {
          if (step.type !== "order") continue;
          const tokens = normalize(step.tokens.join(" "));
          for (const answer of step.answers) expect(normalize(answer), `${lesson.id}.${step.id}`).toBe(tokens);
        }
      }
    }
  });
});
