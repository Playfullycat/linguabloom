// @vitest-environment node
import { describe, expect, it } from "vitest";

import { toCsv } from "./csv";
import { describeDueIn, startOfLocalDay } from "./time";

describe("toCsv", () => {
  it("adds a BOM, quotes special characters and neutralises formulas", () => {
    const csv = toCsv(["word", "note"], [["Thank you. / Thanks.", 'say "hi", then go'], ["=1+1", null]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('Thank you. / Thanks.,"say ""hi"", then go"');
    expect(csv).toContain("'=1+1,");
    expect(csv.split("\r\n")).toHaveLength(4);
  });
});

describe("time helpers", () => {
  it("finds the start of the local day in a timezone", () => {
    // 2026-11-07 01:30 in Shanghai is 2026-11-06 17:30 UTC; local day starts at 16:00 UTC.
    expect(startOfLocalDay(new Date("2026-11-06T17:30:00Z"), "Asia/Shanghai").toISOString()).toBe("2026-11-06T16:00:00.000Z");
  });

  it("describes due times in plain Chinese", () => {
    const now = new Date("2026-11-07T00:00:00Z");
    expect(describeDueIn(new Date("2026-11-07T00:10:00Z"), now)).toBe("10 分钟后");
    expect(describeDueIn(new Date("2026-11-10T00:00:00Z"), now)).toBe("3 天后");
    expect(describeDueIn(new Date("2026-11-06T00:00:00Z"), now)).toBe("现在");
  });
});
