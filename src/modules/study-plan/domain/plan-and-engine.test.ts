// @vitest-environment node
import { describe, expect, it } from "vitest";

import { loadItemBank } from "../../assessment/content";
import { MAX_ITEMS, PLACEMENT_LEVELS, estimateSkill, nextItem, scoreItem, startLevel, toClientItem } from "../../assessment/domain/engine";
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
  remediation: null,
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

  it("fits a recurring error in after the lesson without changing the total", () => {
    const plan = buildPlan(facts({ remediation: { itemId: "e1", title: "be 动词", categoryLabel: "主谓一致", count: 3, mode: "remediation" } }));
    expect(plan.map((t) => t.kind)).toEqual(["review", "lesson", "remediation"]);
    expect(plan[2]).toMatchObject({ href: "/errors/e1", minutes: 5 });
    expect(plan[2]!.reason).toContain("出现 3 次");
    expect(plan.reduce((s, t) => s + t.minutes, 0)).toBe(25);
    expect(buildPlan(facts({ mode: "review_only", remediation: { itemId: "e1", title: "x", categoryLabel: "y", count: 2, mode: "retest" } })).map((t) => t.kind)).toEqual(["review"]);
  });

  it("adds a short PTE task for the exam goal in longer sessions only, keeping the total", () => {
    const pte = { taskCode: "r_mcma", nameZh: "阅读多选", avgShare: 0.4 };
    const plan = buildPlan(facts({ pte }));
    expect(plan.at(-1)).toMatchObject({ kind: "pte", href: "/pte/r_mcma", minutes: 6, targetId: "r_mcma" });
    expect(plan.at(-1)!.reason).toContain("40%");
    expect(plan.reduce((s, t) => s + t.minutes, 0)).toBe(25);
    expect(buildPlan(facts({ pte, sessionMinutes: 15 })).some((t) => t.kind === "pte")).toBe(false);
    expect(buildPlan(facts({ pte: { ...pte, avgShare: null } })).at(-1)!.reason).toContain("还没练过");
  });

  it("adds a 5-minute fluency task on an easy text, keeping the total and the main task (fluency)", () => {
    const fluency = { kind: "speed_reading" as const, contentId: "rd-a1-my-morning", titleEn: "My Morning", titleZh: "我的早晨", levelLabel: "A1", why: "completed" as const, weekMinutes: 3, weekTarget: 10 };
    const plan = buildPlan(facts({ fluency }));
    expect(plan.map((t) => t.kind)).toEqual(["review", "lesson", "fluency"]);
    expect(plan.at(-1)).toMatchObject({ href: "/fluency/speed_reading/rd-a1-my-morning", minutes: 5, targetId: "rd-a1-my-morning" });
    expect(plan.at(-1)!.title).toContain("快速阅读");
    expect(plan.at(-1)!.reason).toContain("读完过");
    expect(plan.at(-1)!.reason).toContain("已练 3 分钟，目标约 10 分钟");
    expect(plan.reduce((s, t) => s + t.minutes, 0)).toBe(25);
    // Not in 15-minute sessions; not when it would squeeze the lesson below 8 minutes (25 min + remediation).
    expect(buildPlan(facts({ fluency, sessionMinutes: 15 })).some((t) => t.kind === "fluency")).toBe(false);
    const remediation = { itemId: "e1", title: "be 动词", categoryLabel: "语法", count: 3, mode: "remediation" as const };
    expect(buildPlan(facts({ fluency, remediation, dueReviews: 25 })).some((t) => t.kind === "fluency")).toBe(false);
    expect(buildPlan(facts({ fluency, remediation })).some((t) => t.kind === "fluency")).toBe(true); // a short review leaves the lesson room
    // In a 60-minute session it fits next to PTE, and PTE never takes time from it.
    const pte = { taskCode: "r_mcma", nameZh: "阅读多选", avgShare: 0.4 };
    const long = buildPlan(facts({ fluency, pte, sessionMinutes: 60, inputMaterial: null, outputLesson: lesson({ id: "x", hasOutputTask: true }) }));
    expect(long.find((t) => t.kind === "fluency")!.minutes).toBe(5);
    expect(long.some((t) => t.kind === "pte")).toBe(true);
    expect(long.reduce((s, t) => s + t.minutes, 0)).toBe(60);
    expect(buildPlan(facts({ fluency: { ...fluency, why: "easier" } })).at(-1)!.reason).toContain("比你现在的水平简单");
  });

  it("on a heavy review day gives review more time, shortens the lesson and explains why (Phase 5.3)", () => {
    // 50 due cards ≈ 20 minutes: more than half of a 25-minute session.
    const plan = buildPlan(facts({ dueReviews: 50, newCardsAvailable: 10 }));
    const review = plan.find((t) => t.kind === "review")!;
    const lessonTask = plan.find((t) => t.kind === "lesson")!;
    expect(review.minutes).toBe(15); // 60% of 25
    expect(lessonTask.minutes).toBe(10);
    expect(review.reason).toContain("到期的卡片比较多");
    expect(review.reason).not.toContain("张新卡可以开始学");
    expect(plan.reduce((s, t) => s + t.minutes, 0)).toBe(25);
    // A normal day keeps the template.
    expect(buildPlan(facts({ dueReviews: 10 })).find((t) => t.kind === "review")!.reason).not.toContain("比较多");
  });

  it("says what a lesson builds toward, why a text was picked and which productive can-do needs evidence", () => {
    const plan = buildPlan(
      facts({
        sessionMinutes: 60,
        nextLesson: lesson({ canDoZh: "能用简单的日常用语打招呼和道别。" }),
        inputMaterial: { id: "ls-a1-x", type: "listening", titleEn: "X", titleZh: "X", levelLabel: "A1", newWords: 3, fit: "right", reasons: ["你的听力（Pre-A1）低于阅读（A1），今天先补这一项"] },
        outputLesson: lesson({ id: "u3-l3", hasOutputTask: true, gapZh: "能进行简单的自我介绍。" }),
      }),
    );
    expect(plan.find((t) => t.kind === "lesson")!.reason).toContain("这节课练的是：能用简单的日常用语打招呼和道别。");
    expect(plan.find((t) => t.kind === "input")!.reason).toContain("你的听力（Pre-A1）低于阅读（A1）");
    expect(plan.find((t) => t.kind === "output")!.reason).toContain("“能进行简单的自我介绍。”还没有足够的证据");
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

  it("item bank covers every skill at every placement level, with room for retakes", () => {
    expect(bank.items).toHaveLength(126);
    for (const level of PLACEMENT_LEVELS) {
      for (const [skill, min] of [["vocabulary", 5], ["grammar", 5], ["reading", 4], ["listening", 4]] as const) {
        expect(bank.items.filter((i) => i.skill === skill && i.level === level).length, `${skill} ${level}`).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it("every item is answerable: distinct options, distinct prompts, non-empty cloze answers", () => {
    for (const item of bank.items) {
      if (item.type === "choice") {
        expect(new Set(item.options).size, item.id).toBe(item.options.length);
      } else {
        expect(item.answers.every((a) => a.trim().length > 0), item.id).toBe(true);
      }
    }
    const prompts = bank.items.map((i) => (i.type === "choice" ? `${i.skill}|${i.passage_en ?? i.audio_en ?? i.prompt_en}|${i.prompt_zh}` : `${i.skill}|${i.sentence_en}`));
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it("draws a per-session order among equally suitable items, stable within a session", () => {
    const vocab = bank.items.filter((i) => i.skill === "vocabulary");
    const first = (seed?: string) => nextItem("vocabulary", [], vocab, "a1", new Set(), seed)!.id;
    expect(first()).toBe("voc-a1-1"); // no seed: easiest first
    expect(first("session-1")).toBe(first("session-1"));
    const drawn = new Set(Array.from({ length: 30 }, (_, i) => first(`session-${i}`)));
    expect(drawn.size).toBeGreaterThanOrEqual(3);
    expect([...drawn].every((id) => id.startsWith("voc-a1-"))).toBe(true);
    // Items from the previous diagnostic still lose to unseen ones, whatever the seed.
    const avoid = new Set(vocab.filter((i) => i.level === "a1" && i.id !== "voc-a1-4").map((i) => i.id));
    for (let i = 0; i < 10; i++) expect(nextItem("vocabulary", [], vocab, "a1", avoid, `s${i}`)!.id).toBe("voc-a1-4");
  });

  it("starts from the self-report but never trusts it as a level", () => {
    expect(startLevel("beginner")).toBe("pre_a1");
    expect(startLevel("forgot")).toBe("a1");
    expect(startLevel("read_simple")).toBe("a2");
    expect(startLevel("daily_conversation")).toBe("b1");
    expect(startLevel("advanced")).toBe("b2");
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
    // B1 is no longer the top of the bank, so all-correct at B1 doesn't mean "may be higher".
    expect(estimateSkill(six)).toMatchObject({ level: "b1", confidence: "medium", mayBeHigher: false });
    const topRight = Array.from({ length: 6 }, (_, i) => ({ itemId: String(i), level: "c2", isCorrect: true }));
    expect(estimateSkill(topRight)).toMatchObject({ level: "c2", mayBeHigher: true });
  });

  it("covers every skill at every level up to C2, and an all-correct run can reach C2", () => {
    for (const skill of ["vocabulary", "grammar", "reading", "listening"] as const) {
      for (const level of ["b2", "c1", "c2"]) expect(bank.items.some((i) => i.skill === skill && i.level === level), `${skill} ${level}`).toBe(true);
      const items = bank.items.filter((i) => i.skill === skill);
      const attempts: { itemId: string; level: string; isCorrect: boolean }[] = [];
      for (let item = nextItem(skill, attempts, items, startLevel("read_simple")); item; item = nextItem(skill, attempts, items, startLevel("read_simple"))) {
        attempts.push({ itemId: item.id, level: item.level, isCorrect: true });
      }
      expect(estimateSkill(attempts)!.level, skill).toBe("c2");
    }
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
