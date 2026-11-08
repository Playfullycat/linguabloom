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
  /** The can-do statement this lesson builds toward (shown in the reason). */
  canDoZh?: string | null;
  /** For a lesson suggested again for output: a productive can-do that has no passing evidence yet. */
  gapZh?: string | null;
};

export type InputMaterialRef = {
  id: string;
  type: "reading" | "listening";
  titleEn: string;
  titleZh: string;
  levelLabel: string;
  newWords: number;
  fit: "easier" | "right" | "stretch" | "hard";
  /** Why this text today: skill gap, first evidence for a can-do (Phase 5.3). */
  reasons?: string[];
};

export type RemediationRef = {
  itemId: string;
  title: string;
  categoryLabel: string;
  count: number;
  mode: "remediation" | "retest";
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
  /** A recurring error to fix (or retest) today. */
  remediation: RemediationRef | null;
  /** Placement estimate used for the recommendation text, if any. */
  startingLevelLabel: string | null;
  /** The learner prepares for PTE (goal "exam"): one short practice of the weakest task type. */
  pte?: PteRef | null;
};

export type PteRef = { taskCode: string; nameZh: string; avgShare: number | null };

/** PTE is a side track (spec §5.13): only in sessions of this length or longer, and only a few minutes. */
export const PTE_MIN_SESSION = 25;
const PTE_MINUTES = 6;

export type PlannedTask = {
  kind: "review" | "lesson" | "remediation" | "input" | "output" | "pte";
  title: string;
  href: string;
  minutes: number;
  reason: string;
  targetId: string | null;
};

const MINUTES_PER_CARD = 0.4;

/** Due reviews that would take more than this share of the session make a "heavy review day" (Phase 5.3). */
export const HEAVY_REVIEW_SHARE = 0.5;
/** On a heavy review day, review may take up to this share; the lesson gives up the time. */
const HEAVY_REVIEW_MAX_SHARE = 0.6;
const MIN_LESSON_MINUTES = 5;

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
  // Review load: when due cards alone would fill more than half the session, clear them first.
  const dueNeed = facts.dueReviews * MINUTES_PER_CARD;
  const heavy = facts.mode === "normal" && facts.dueReviews > 0 && dueNeed > minutes * HEAVY_REVIEW_SHARE;

  const reviewTask = (budget: number): PlannedTask | null => {
    if (reviewable === 0) return null;
    const newPart = heavy ? 0 : Math.min(facts.newCardsAvailable, 20) * MINUTES_PER_CARD;
    const need = Math.max(3, Math.ceil(dueNeed + newPart));
    const parts: string[] = [];
    if (facts.dueReviews > 0) parts.push(`${facts.dueReviews} 张卡片到期，先复习能把快要忘记的内容拉回来`);
    if (heavy) parts.push("到期的卡片比较多，今天先把它们清掉，新卡排在最后，时间不够可以留到明天；课程时间相应缩短");
    else if (facts.newCardsAvailable > 0) parts.push(`${facts.newCardsAvailable} 张新卡可以开始学`);
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
    const goal = l.canDoZh ? `这节课练的是：${l.canDoZh}` : "";
    return {
      kind: "lesson",
      title: `${l.inProgress ? "继续" : "学习"}：${lessonTitle(l)}`,
      href: `/lesson/${l.id}`,
      minutes: budget,
      reason: [reason, goal ? `${goal}。` : "", l.hasOutputTask ? "这节课里有开口说或动手写的任务。" : ""].join(""),
      targetId: l.id,
    };
  };

  // On a heavy review day the review block grows and the lesson block gives up the time.
  const blocks = getSessionTemplate(minutes).map((b) => ({ ...b }));
  if (heavy) {
    const review = blocks.find((b) => b.kind === "review");
    const lesson = blocks.find((b) => b.kind === "lesson");
    if (review && lesson) {
      const target = Math.min(Math.ceil(dueNeed), Math.round(minutes * HEAVY_REVIEW_MAX_SHARE));
      const extra = Math.max(0, Math.min(target - review.minutes, lesson.minutes - MIN_LESSON_MINUTES));
      review.minutes += extra;
      lesson.minutes -= extra;
    }
  }

  let carry = 0;
  for (const block of blocks) {
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
          reason: `一篇 ${m.levelLabel} ${kind}，生词 ${m.newWords} 个，${fit}。${(m.reasons ?? []).map((r) => `${r}。`).join("")}能读懂、听懂的真实内容最能积累语感。`,
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
        reason: l.gapZh
          ? `“${l.gapZh}”还没有足够的证据，再做一次这节课的口语或写作任务正好补上。`
          : "把这节课的口语或写作任务再做一次。每天用学过的英语表达自己，才能检验是不是真的会用。",
        targetId: l.id,
      });
    }
  }

  // Recurring errors come right after reviews and the lesson (spec §4.3); 5 minutes from the longest task.
  if (facts.remediation) {
    const r = facts.remediation;
    const donor = [...tasks].filter((t) => t.kind !== "review").sort((a, b) => b.minutes - a.minutes)[0] ?? tasks[0];
    let minutes = 5;
    if (donor) {
      minutes = Math.max(2, Math.min(5, donor.minutes - 3));
      donor.minutes -= minutes;
    } else carry = Math.max(0, carry - minutes);
    const after = Math.max(tasks.findLastIndex((t) => t.kind === "lesson"), tasks.findLastIndex((t) => t.kind === "review"));
    tasks.splice(after + 1, 0, {
      kind: "remediation",
      title: r.mode === "retest" ? `换个语境再测：${r.title}` : `补救练习：${r.title}`,
      href: `/errors/${r.itemId}`,
      minutes,
      reason:
        r.mode === "retest"
          ? `昨天的补救练习通过了。今天用 2 道新题再测一次（${r.categoryLabel}），确认真的掌握了。`
          : `这个错误（${r.categoryLabel}）已经出现 ${r.count} 次。做 3 道针对练习，通过后明天换个语境再测。`,
      targetId: r.itemId,
    });
  }

  // PTE practice (goal "exam"): a few minutes taken from the longest task, at the end.
  if (facts.pte && minutes >= PTE_MIN_SESSION) {
    const p = facts.pte;
    const donor = [...tasks].filter((t) => t.kind !== "review" && t.kind !== "remediation").sort((a, b) => b.minutes - a.minutes)[0];
    if (donor && donor.minutes - PTE_MINUTES >= 5) {
      donor.minutes -= PTE_MINUTES;
      tasks.push({
        kind: "pte",
        title: `PTE 练习：${p.nameZh}`,
        href: `/pte/${p.taskCode}`,
        minutes: PTE_MINUTES,
        reason:
          p.avgShare === null
            ? "你的目标里有考试准备：今天试一个还没练过的 PTE 题型，先熟悉题型和时间。"
            : `你的目标里有考试准备：这个题型目前的平均得分率是 ${Math.round(p.avgShare * 100)}%，是你最需要加强的一类。PTE 只占几分钟，主线学习仍然优先。`,
        targetId: p.taskCode,
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
