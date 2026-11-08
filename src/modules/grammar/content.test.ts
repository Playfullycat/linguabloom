// @vitest-environment node
import { describe, expect, it } from "vitest";

import { SCORED_TYPES, loadGrammar } from "./content";

describe("grammar map", () => {
  it("follows the teaching order with valid prerequisites and enough exercises", () => {
    const points = loadGrammar();
    expect(points.map((p) => p.order)).toEqual(points.map((_, i) => i + 1));
    const published = points.filter((p) => p.status === "published");
    expect(published).toHaveLength(20);
    for (const p of published) {
      expect(p.exercises.filter((e) => SCORED_TYPES.includes(e.type)).length).toBeGreaterThanOrEqual(5);
    }
    expect(points.filter((p) => p.status === "planned").every((p) => p.exercises.length === 0)).toBe(true);
  });
});
