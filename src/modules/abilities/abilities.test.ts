// @vitest-environment node
import { describe, expect, it } from "vitest";

import { nextItem } from "../assessment/domain/engine";
import { SKILLS } from "../curriculum/content/schema";
import { loadSpeakingTasks } from "../speaking/content";
import { defaultPassRule, loadCanDo } from "./content";
import { canDoStatus, type EvidenceLike } from "./domain/status";

describe("can-do content", () => {
  const { statements, links } = loadCanDo();

  it("merges unit objectives and the level catalog with unique ids and known prerequisites", () => {
    const ids = statements.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(statements.filter((s) => s.origin.startsWith("unit:")).length).toBe(30);
    expect(statements.some((s) => s.origin === "catalog" && s.level === "a2")).toBe(true);
    // Units also give evidence for level-wide catalog statements (Phase 5.1).
    const pastEvents = statements.find((s) => s.id === "a2.sp.past-events")!;
    expect(pastEvents.origin).toBe("catalog");
    expect(pastEvents.routes.some((r) => r.href === "/lesson/a2-u01-past-stories-l2")).toBe(true);
    for (const s of statements) {
      expect(SKILLS).toContain(s.skill);
      for (const p of s.prerequisites) expect(ids).toContain(p);
    }
  });

  it("links practice to statements and lists where to practise", () => {
    expect(links.materials.get("ls-a2-lost-phone")).toEqual(["a2.l.conversations"]);
    expect(links.grammarPoints.get("be-verb")).toEqual(["a1.gr.be"]);
    expect(links.lessons.get("a1-u01-pronouns-be-l1")).toContain("a1.gr.be");
    expect(loadSpeakingTasks().every((t) => t.can_do_ids.length > 0)).toBe(true);
    const be = statements.find((s) => s.id === "a1.gr.be")!;
    expect(be.evidenceTypes).toEqual(expect.arrayContaining(["lesson", "exercise"]));
    expect(be.routes.find((r) => r.type === "exercise")?.href).toBe("/grammar/be-verb");
  });

  it("productive skills need a non-self-rated piece; receptive skills need more evidence", () => {
    expect(defaultPassRule("spoken_interaction")).toMatchObject({ needsMedium: true, minWeight: 2 });
    expect(defaultPassRule("reading")).toMatchObject({ needsMedium: false, minWeight: 3 });
  });
});

const day = (d: number, h = 10) => new Date(Date.UTC(2026, 10, d, h));
const ev = (outcome: "pass" | "fail", confidence: "low" | "medium", d: number, h = 10): EvidenceLike => ({ outcome, confidence, weight: confidence === "low" ? 0.5 : 1, occurredAt: day(d, h) });
const receptive = defaultPassRule("reading");
const productive = defaultPassRule("spoken_production");
const now = day(20);

describe("can-do status", () => {
  it("no evidence → not started", () => {
    expect(canDoStatus([], receptive, "UTC", now)).toMatchObject({ status: "not_started", evidenceCount: 0, lastVerifiedAt: null });
  });

  it("three passes on two days with a good recent rate → shown", () => {
    const r = canDoStatus([ev("pass", "medium", 1), ev("pass", "medium", 1, 11), ev("fail", "medium", 2), ev("pass", "medium", 3)], receptive, "UTC", now);
    expect(r).toMatchObject({ status: "shown", passWeight: 3, passDays: 2, recentRate: 0.75, missing: [] });
    expect(r.lastVerifiedAt).toEqual(day(3));
  });

  it("explains what is missing", () => {
    const sameDay = canDoStatus([ev("pass", "medium", 1), ev("pass", "medium", 1, 11), ev("pass", "medium", 1, 12)], receptive, "UTC", now);
    expect(sameDay.status).toBe("emerging");
    expect(sameDay.missing.join()).toContain("不同的日子");
    const lowRate = canDoStatus([ev("pass", "medium", 1), ev("pass", "medium", 2), ev("pass", "medium", 3), ev("fail", "medium", 4), ev("fail", "medium", 5)], receptive, "UTC", now);
    expect(lowRate.status).toBe("emerging");
    expect(lowRate.missing.join()).toContain("正确率");
  });

  it("days follow the learner's time zone", () => {
    // 23:30 and 00:30 UTC are the same morning in Shanghai.
    const r = canDoStatus([ev("pass", "medium", 1, 23), ev("pass", "medium", 2, 0), ev("pass", "medium", 2, 1)], receptive, "Asia/Shanghai", now);
    expect(r.passDays).toBe(1);
  });

  it("self-ratings alone never show a productive skill", () => {
    const selfOnly = canDoStatus([ev("pass", "low", 1), ev("pass", "low", 2), ev("pass", "low", 3), ev("pass", "low", 4)], productive, "UTC", now);
    expect(selfOnly.status).toBe("emerging");
    expect(selfOnly.missing.join()).toContain("自评不算");
    const withTask = canDoStatus([ev("pass", "low", 1), ev("pass", "low", 2), ev("pass", "medium", 3)], productive, "UTC", now);
    expect(withTask.status).toBe("shown");
  });

  it("shown long ago is flagged as stale", () => {
    const r = canDoStatus([ev("pass", "medium", 1), ev("pass", "medium", 2), ev("pass", "medium", 3)], receptive, "UTC", new Date(day(3).getTime() + 61 * 86_400_000));
    expect(r).toMatchObject({ status: "shown", stale: true });
  });
});

describe("diagnostic retake", () => {
  const items = [
    { id: "v1", skill: "vocabulary" as const, level: "a1", difficulty: 0.1 },
    { id: "v2", skill: "vocabulary" as const, level: "a1", difficulty: 0.2 },
    { id: "v3", skill: "vocabulary" as const, level: "a2", difficulty: 0.3 },
  ];
  it("prefers items the learner didn't see last time, at the same level", () => {
    expect(nextItem("vocabulary", [], items, "a1")?.id).toBe("v1");
    expect(nextItem("vocabulary", [], items, "a1", new Set(["v1"]))?.id).toBe("v2");
    // Nothing else suitable at that level: an old item is still better than a much harder one.
    expect(nextItem("vocabulary", [], items, "a1", new Set(["v1", "v2"]))?.id).toBe("v1");
  });
});
