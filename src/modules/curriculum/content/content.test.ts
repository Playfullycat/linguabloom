// @vitest-environment node
import { describe, expect, it } from "vitest";

import { CEFR_LEVELS } from "../domain/cefr";
import { loadContent } from "./load";
import { publishProblems } from "./quality";
import { unitFileSchema, type UnitFile } from "./schema";

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

  it("has two published units each for A2 and B1 (Phase 5.1); everything else without a file stays planned", () => {
    const { catalog, units } = loadContent();
    for (const level of ["a2", "b1"] as const) {
      const published = [...units.values()].filter((f) => f.unit.level === level && f.unit.status === "published");
      expect(published.length, level).toBeGreaterThanOrEqual(2);
    }
    for (const entry of catalog.units) expect(units.has(entry.id)).toBe(Boolean(entry.file));
  });

  it("every published unit passes the publish gate", () => {
    const { units } = loadContent();
    for (const file of units.values()) if (file.unit.status === "published") expect(publishProblems(file), file.unit.id).toEqual([]);
  });

  it("the publish gate stops units that are not really learnable", () => {
    const { units } = loadContent();
    const base = [...units.values()].find((f) => f.unit.level === "a2")!;
    const issues = (mutate: (f: UnitFile) => void) => {
      const f = structuredClone(base);
      mutate(f);
      return publishProblems(f).join("\n");
    };
    // No practice: a lesson with fewer than three scored steps.
    expect(issues((f) => (f.unit.lessons[0]!.steps = f.unit.lessons[0]!.steps.filter((s) => !["choice", "cloze", "order", "match"].includes(s.type) || s.role === "exit_ticket").slice(0, 5)))).toMatch(/scored steps/);
    // A promised word that no lesson teaches.
    expect(issues((f) => f.unit.vocabulary.push({ ...f.unit.vocabulary[0]!, key: "never-taught" }))).toMatch(/never-taught is not introduced/);
    // A can-do statement no lesson practises.
    expect(issues((f) => f.unit.can_do.push({ ...f.unit.can_do[0]!, id: "a2.x.orphan" }))).toMatch(/a2.x.orphan is not practised/);
    // A review lesson without speaking or writing.
    expect(issues((f) => (f.unit.lessons.find((l) => l.kind === "review")!.steps = f.unit.lessons.find((l) => l.kind === "review")!.steps.filter((s) => s.type !== "speak" && s.type !== "write")))).toMatch(/review lesson needs a speaking or writing task/);
    // A dialogue line far above the level.
    expect(issues((f) => {
      const d = f.unit.lessons[0]!.steps.find((s) => s.type === "dialogue")!;
      if (d.type === "dialogue") d.lines[0]!.en = Array.from({ length: 30 }, () => "word").join(" ");
    })).toMatch(/30 words \(max 20/);
    // Third-party content without a source.
    expect(issues((f) => (f.source_type = "licensed"))).toMatch(/needs a source/);
    // Drafts may be partial: the schema only applies the gate to published units.
    const draft = structuredClone(base);
    draft.unit.status = "draft";
    draft.unit.lessons = draft.unit.lessons.filter((l) => l.kind === "core");
    expect(unitFileSchema.safeParse(draft).success).toBe(true);
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
