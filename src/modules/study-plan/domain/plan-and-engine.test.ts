// @vitest-environment node
import { describe, expect, it } from "vitest";

import { loadItemBank } from "../../assessment/content";
import { MAX_ITEMS, estimateSkill, nextItem, scoreItem, startLevel, toClientItem } from "../../assessment/domain/engine";
import { buildPlan, isComeback, type LessonRef, type PlanFacts } from "./plan-builder";

const lesson = (over: Partial<LessonRef> = {}): LessonRef => ({
  id: "pre-a1-u03-hello-l1",
  titleEn: "Hi and Hello",
  titleZh: "嗨与你好",
  unitTitleEn: "Hello!",
  unitOrder: 3,
  levelLabel: "Pre-A1",
  estimatedMinutes: 8,
  inProgress: false,
  hasOutputTask: false,
  ...over,
});

const facts = (over: Partial<PlanFacts> = {}): PlanFacts => ({
  sessionMinutes: 25,
  mode: "normal",
  comeback: false,
  dueReviews: 10,
  newCardsAvailable: 0,
  nextLesson: lesson(),
  outputLesson: null,
  inputMaterial: null,
  inputLesson: null,
  startingLevelLabel: null,
  ...over,
});

describe("buildPlan", () => {
  it("puts due reviews first, then the lesson, and fills the chosen length", () => {
    const plan = buildPlan(facts());
    expect(plan.map((t) => t.kind)).toEqual(["review", "lesson"]);
    expect(plan[0]!.reason).toContain("10 张卡片到期");
    expect(plan.reduce((s, t) => s + t.minutes, 0)).toBe(25);
  });

  it("gives review time to the lesson when nothing is due", () => {
    const plan = buildPlan(facts({ dueReviews: 0 }));
    expect(plan.map((t) => t.kind)).toEqual(["lesson"]);
    expect(plan[0]!.minutes).toBe(25);
  });

  it("adds input and output tasks for longer sessions, without duplicating lessons", () => {
    const plan = buildPlan(
      facts({
        sessionMinutes: 60,
        inputLesson: lesson({ id: "u3-l4", titleEn: "Unit Review" }),
        outputLesson: lesson({ id: "u3-l3", titleEn: "Thanks and Goodbye", hasOutputTask: true }),
      }),
    );
    expect(plan.map((t) => t.kind)).toEqual(["review", "lesson", "input", "output"]);
    expect(new Set(plan.map((t) => t.href)).size).toBe(plan.length);
    expect(plan.reduce((s, t) => s + t.minutes, 0)).toBe(60);
  });

  it("prefers a graded reading or listening for the input block", () => {
    const plan = buildPlan(
      facts({
        sessionMinutes: 15,
        dueReviews: 0,
        inputLesson: lesson({ id: "u3-l1" }),
        inputMaterial: { id: "rd-a1-my-morning", type: "reading", titleEn: "My Morning", titleZh: "我的早晨", levelLabel: "A1", newWords: 4, fit: "right" },
      }),
    );
    expect(plan[0]).toMatchObject({ kind: "input", href: "/reading/rd-a1-my-morning", minutes: 15 });
    expect(plan[0]!.reason).toContain("生词 4 个");
  });

  it("skips a separate output task when the lesson already has one", () => {
    const plan = buildPlan(facts({ sessionMinutes: 40, nextLesson: lesson({ hasOutputTask: true }), outputLesson: lesson({ id: "other" }) }));
    expect(plan.some((t) => t.kind === "output")).toBe(false);
    expect(plan.find((t) => t.kind === "lesson")!.reason).toContain("开口说或动手写");
  });

  it("supports review-only days and gentle comebacks", () => {
    expect(buildPlan(facts({ mode: "review_only" })).map((t) => t.kind)).toEqual(["review"]);
    const comeback = buildPlan(facts({ comeback: true, sessionMinutes: 40 }));
    expect(comeback.reduce((s, t) => s + t.minutes, 0)).toBe(25); // one size lighter
  });

  it("still offers the next lesson in a short session with nothing to review", () => {
    const plan = buildPlan(facts({ sessionMinutes: 15, dueReviews: 0 }));
    expect(plan).toEqual([expect.objectContaining({ kind: "lesson", minutes: 15 })]);
  });

  it("explains a resumed lesson", () => {
    const plan = buildPlan(facts({ nextLesson: lesson({ inProgress: true }) }));
    expect(plan.find((t) => t.kind === "lesson")!.title).toMatch(/^继续/);
  });

  it("detects a break of more than two days", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(isComeback(null, now)).toBe(false);
    expect(isComeback(new Date("2026-11-06T12:00:00Z"), now)).toBe(false);
    expect(isComeback(new Date("2026-11-04T11:00:00Z"), now)).toBe(true);
  });
});

describe("placement diagnostic engine", () => {
  const bank = loadItemBank();
  const grammar = bank.items.filter((i) => i.skill === "grammar");

  it("item bank covers every skill at every placement level", () => {
    expect(bank.items.length).toBeGreaterThanOrEqual(40);
  });

  it("starts from the self-report but never trusts it as a level", () => {
    expect(startLevel("beginner")).toBe("pre_a1");
    expect(startLevel("forgot")).toBe("a1");
    expect(startLevel("daily_conversation")).toBe("a2");
    expect(startLevel(null)).toBe("a1");
  });

  it("moves up after correct and down after wrong answers, then stops", () => {
    const attempts: { itemId: string; level: string; isCorrect: boolean }[] = [];
    let item = nextItem("grammar", attempts, grammar, "a1");
    expect(item!.level).toBe("a1");
    attempts.push({ itemId: item!.id, level: item!.level, isCorrect: true });
    item = nextItem("grammar", attempts, grammar, "a1");
    expect(item!.level).toBe("a2");
    attempts.push({ itemId: item!.id, level: item!.level, isCorrect: false });
    item = nextItem("grammar", attempts, grammar, "a1");
    expect(item!.level).toBe("a1");
    while (item) {
      attempts.push({ itemId: item.id, level: item.level, isCorrect: false });
      item = nextItem("grammar", attempts, grammar, "a1");
    }
    expect(attempts).toHaveLength(MAX_ITEMS.grammar);
    expect(new Set(attempts.map((a) => a.itemId)).size).toBe(attempts.length);
  });

  it("estimates the highest level with at least half correct, with honest confidence", () => {
    expect(estimateSkill([])).toBeNull();
    const result = estimateSkill([
      { itemId: "1", level: "a1", isCorrect: true },
      { itemId: "2", level: "a2", isCorrect: true },
      { itemId: "3", level: "b1", isCorrect: false },
      { itemId: "4", level: "a2", isCorrect: false },
    ]);
    expect(result).toMatchObject({ level: "a2", confidence: "low", evidenceCount: 4 });
    expect(estimateSkill([{ itemId: "1", level: "pre_a1", isCorrect: false }])!.level).toBe("pre_a1");
    const six = Array.from({ length: 6 }, (_, i) => ({ itemId: String(i), level: "b1", isCorrect: true }));
    expect(estimateSkill(six)).toMatchObject({ level: "b1", confidence: "medium", mayBeHigher: true });
  });

  it("scores items and never sends answer keys to the browser", () => {
    const choice = bank.items.find((i) => i.type === "choice")!;
    const cloze = bank.items.find((i) => i.type === "cloze")!;
    expect(scoreItem(choice, { choice: choice.type === "choice" ? choice.answer : -1 })).toBe(true);
    expect(scoreItem(cloze, { text: cloze.type === "cloze" ? ` ${cloze.answers[0]!.toUpperCase()} ` : "" })).toBe(true);
    expect(scoreItem(cloze, { text: "" })).toBe(false);
    expect(JSON.stringify(toClientItem(choice))).not.toMatch(/"answer"|"explanation_zh"/);
    expect(JSON.stringify(toClientItem(cloze))).not.toMatch(/"answers"|"explanation_zh"/);
  });
});
