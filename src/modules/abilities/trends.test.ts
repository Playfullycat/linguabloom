// @vitest-environment node
import { describe, expect, it } from "vitest";

import { describeCorrelation, pearson, weekIndex } from "./domain/trends";

describe("learning trends helpers", () => {
  it("computes a Pearson correlation only with enough varied pairs", () => {
    expect(pearson([[1, 2], [2, 4], [3, 6], [4, 8]])).toBeCloseTo(1);
    expect(pearson([[1, 8], [2, 6], [3, 4], [4, 2]])).toBeCloseTo(-1);
    expect(pearson([[1, 2], [2, 4], [3, 6]])).toBeNull(); // fewer than 4 weeks
    expect(pearson([[1, 5], [2, 5], [3, 5], [4, 5]])).toBeNull(); // no variation
  });

  it("describes a correlation honestly, never as a cause", () => {
    expect(describeCorrelation(null)).toContain("数据还不够");
    expect(describeCorrelation(0.82)).toContain("不代表因果");
    expect(describeCorrelation(0.82)).toContain("较强");
    expect(describeCorrelation(-0.5)).toContain("反而偏低");
    expect(describeCorrelation(0.1)).toContain("几乎看不出关系");
  });

  it("puts a local date into the right week", () => {
    const weeks = ["2026-10-26", "2026-11-02"];
    expect(weekIndex(weeks, "2026-10-25")).toBe(-1);
    expect(weekIndex(weeks, "2026-10-26")).toBe(0);
    expect(weekIndex(weeks, "2026-11-01")).toBe(0);
    expect(weekIndex(weeks, "2026-11-08")).toBe(1);
  });
});
