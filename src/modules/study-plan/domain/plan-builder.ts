import { SESSION_LENGTHS, getSessionTemplate, type SessionLength } from "./session-templates";

/**
 * Today's plan (spec §4.3, §4.4, §5.1). Priority: due reviews → current
 * lesson → meaning-focused input → output. Every task says why it is there.
 * Pure function: the service gathers the facts, this decides.
 */

export type LessonRef = {
  id: string;
  titleEn: string;
  titleZh: string;
  unitTitleEn: string;
  unitOrder: number;
  levelLabel: string;
  estimatedMinutes: number;
  inProgress: boolean;
  hasOutputTask: boolean;
};

export type InputMaterialRef = {
  id: string;
  type: "reading" | "listening";
  titleEn: string;
  titleZh: string;
  levelLabel: string;
  newWords: number;
  fit: "easier" | "right" | "stretch" | "hard";
};

export type PlanFacts = {
  sessionMinutes: SessionLength;
  mode: "normal" | "review_only";
  /** Back after a break: lighter plan (spec §4.4). */
  comeback: boolean;
  dueReviews: number;
  newCardsAvailable: number;
  nextLesson: LessonRef | null;
  /** A finished lesson whose speaking/writing task is worth doing again. */
  outputLesson: LessonRef | null;
  /** An unfinished graded reading or listening near the learner's level. */
  inputMaterial: InputMaterialRef | null;
  /** Fallback: a finished lesson with a dialogue to listen to again. */
  inputLesson: LessonRef | null;
  /** Placement estimate used for the recommendation text, if any. */
  startingLevelLabel: string | null;
};

export type PlannedTask = {
  kind: "review" | "lesson" | "input" | "output";
  title: string;
  href: string;
  minutes: number;
  reason: string;
  targetId: string | null;
};

const MINUTES_PER_CARD = 0.4;

function lighter(minutes: SessionLength): SessionLength {
  const i = SESSION_LENGTHS.indexOf(minutes);
  return SESSION_LENGTHS[Math.max(0, i - 1)]!;
}

function lessonTitle(l: LessonRef) {
  return `${l.titleEn}（${l.titleZh}）`;
}

export function buildPlan(facts: PlanFacts): PlannedTask[] {
  const minutes = facts.comeback ? lighter(facts.sessionMinutes) : facts.sessionMinutes;
  const reviewable = facts.dueReviews + facts.newCardsAvailable;
  const tasks: PlannedTask[] = [];

  const reviewTask = (budget: number): PlannedTask | null => {
    if (reviewable === 0) return null;
    const need = Math.max(3, Math.ceil(facts.dueReviews * MINUTES_PER_CARD + Math.min(facts.newCardsAvailable, 20) * MINUTES_PER_CARD));
    const parts: string[] = [];
    if (facts.dueReviews > 0) parts.push(`${facts.dueReviews} 张卡片到期，先复习能把快要忘记的内容拉回来`);
    if (facts.newCardsAvailable > 0) parts.push(`${facts.newCardsAvailable} 张新卡可以开始学`);
    return {
      kind: "review",
      title: facts.dueReviews > 0 ? `复习 ${facts.dueReviews} 张到期卡片` : "开始学新词卡片",
      href: "/review",
      minutes: Math.min(budget, need),
      reason: `${parts.join("；")}。`,
      targetId: null,
    };
  };

  if (facts.mode === "review_only") {
    const task = reviewTask(minutes);
    return task ? [{ ...task, reason: `今天选择了“只复习”。${task.reason}` }] : [];
  }

  const lessonTask = (l: LessonRef, budget: number): PlannedTask => {
    const where = `${l.levelLabel} · Unit ${l.unitOrder} ${l.unitTitleEn}`;
    const reason = l.inProgress
      ? `你上次学到一半，接着学最省力（${where}）。`
      : facts.startingLevelLabel
        ? `这是当前单元的下一课（${where}）。根据诊断的初步估计，从 ${facts.startingLevelLabel} 开始比较合适。`
        : `这是当前单元的下一课（${where}）。`;
    return {
      kind: "lesson",
      title: `${l.inProgress ? "继续" : "学习"}：${lessonTitle(l)}`,
      href: `/lesson/${l.id}`,
      minutes: budget,
      reason: l.hasOutputTask ? `${reason}这节课里有开口说或动手写的任务。` : reason,
      targetId: l.id,
    };
  };

  let carry = 0;
  for (const block of getSessionTemplate(minutes)) {
    const budget = block.minutes + carry;
    carry = 0;
    if (block.kind === "review") {
      const task = reviewTask(budget);
      if (task) {
        tasks.push(task);
        carry = budget - task.minutes;
      } else carry = budget;
    } else if (block.kind === "lesson") {
      const l = facts.nextLesson;
      if (!l) {
        carry = budget;
        continue;
      }
      tasks.push(lessonTask(l, budget));
    } else if (block.kind === "input") {
      const m = facts.inputMaterial;
      if (m) {
        const kind = m.type === "reading" ? "阅读" : "听力";
        const fit = { easier: "比你现在的水平简单一点，适合练流畅", right: "和你现在的水平差不多", stretch: "比你现在的水平稍高，可以打开中文辅助", hard: "偏难" }[m.fit];
        tasks.push({
          kind: "input",
          title: `${kind}：${m.titleEn}（${m.titleZh}）`,
          href: `/${m.type}/${m.id}`,
          minutes: budget,
          reason: `一篇 ${m.levelLabel} ${kind}，生词 ${m.newWords} 个，${fit}。能读懂、听懂的真实内容最能积累语感。`,
          targetId: m.id,
        });
        continue;
      }
      const l = facts.inputLesson;
      if (!l || l.id === facts.nextLesson?.id) {
        carry = budget;
        continue;
      }
      tasks.push({
        kind: "input",
        title: `重听对话：${lessonTitle(l)}`,
        href: `/lesson/${l.id}`,
        minutes: budget,
        reason: "重听一段学过的对话：几乎都能听懂的输入最能积累语感。先只听，再看文字（阅读和听力专区在 Phase 2 上线）。",
        targetId: l.id,
      });
    } else if (block.kind === "output") {
      if (facts.nextLesson?.hasOutputTask) {
        carry = budget;
        continue;
      }
      const l = facts.outputLesson;
      if (!l || l.id === facts.nextLesson?.id) {
        carry = budget;
        continue;
      }
      tasks.push({
        kind: "output",
        title: `再说一次：${lessonTitle(l)}`,
        href: `/lesson/${l.id}`,
        minutes: budget,
        reason: "把这节课的口语或写作任务再做一次。每天用学过的英语表达自己，才能检验是不是真的会用。",
        targetId: l.id,
      });
    }
  }

  // Leftover minutes go to the lesson (or review) so the plan matches the chosen length.
  if (carry > 0 && facts.nextLesson && !tasks.some((t) => t.kind === "lesson")) {
    tasks.push(lessonTask(facts.nextLesson, carry));
  } else if (carry > 0 && tasks.length > 0) {
    const target = tasks.find((t) => t.kind === "lesson") ?? tasks[0]!;
    target.minutes += carry;
  }
  return tasks;
}

/** More than this many days without study counts as a break (spec §4.4). */
export const COMEBACK_AFTER_DAYS = 2;

export function isComeback(lastActivity: Date | null, now: Date): boolean {
  if (!lastActivity) return false;
  return now.getTime() - lastActivity.getTime() > COMEBACK_AFTER_DAYS * 86_400_000;
}
