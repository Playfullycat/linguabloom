import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/connection";
import {
  assessmentSessions,
  cefrLevels,
  contentInteractions,
  errorItems,
  learnerLessonProgress,
  lessonStepAttempts,
  lessonSteps,
  lessons,
  reviewLogs,
  studyPlanTasks,
  studyPlans,
  units,
} from "@/db/schema";
import { localDateString, startOfLocalDay } from "@/lib/time";
import { getCurrentEstimates } from "@/modules/assessment/services/assessment";
import { CEFR_LEVELS } from "@/modules/curriculum/domain/cefr";
import { PLACEMENT_LEVELS } from "@/modules/assessment/domain/engine";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { errorSummary } from "@/modules/errors/services/errors";
import { ERROR_CATEGORY_LABELS } from "@/modules/grammar/content";
import { pickInputMaterial } from "@/modules/materials/services/materials";
import { getReviewQueue } from "@/modules/review/services/review";

import { buildPlan, isComeback, type LessonRef, type PlannedTask } from "../domain/plan-builder";
import { isSessionLength, type SessionLength } from "../domain/session-templates";

/**
 * Today's plan, persisted per local day so reordering and skipping stick.
 * "Done" is never stored: it is derived from real activity (lesson
 * completion, step attempts, review logs), so the plan can't lie.
 */

export const SKIP_REASONS = ["no_time", "too_tired", "too_hard", "too_easy", "not_interested", "other"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  no_time: "今天时间不够",
  too_tired: "有点累",
  too_hard: "太难了",
  too_easy: "太简单了",
  not_interested: "不感兴趣",
  other: "其他原因",
};

export class PlanTaskNotFoundError extends Error {}

const OUTPUT_SKILLS = ["spoken_production", "spoken_interaction", "written_production", "written_interaction"];

// ------------------------------------------------------------------ facts ----

type LessonRow = {
  id: string;
  titleEn: string;
  titleZh: string;
  estimatedMinutes: number;
  unitTitleEn: string;
  unitOrder: number;
  level: string;
  levelLabel: string;
  levelOrder: number;
  lessonOrder: number;
  status: string | null;
  updatedAt: Date | null;
  completedAt: Date | null;
};

async function loadPublishedLessons(db: DbExecutor, userId: string): Promise<LessonRow[]> {
  return db
    .select({
      id: lessons.id,
      titleEn: lessons.titleEn,
      titleZh: lessons.titleZh,
      estimatedMinutes: lessons.estimatedMinutes,
      unitTitleEn: units.titleEn,
      unitOrder: units.sortOrder,
      level: units.level,
      levelLabel: cefrLevels.label,
      levelOrder: cefrLevels.sortOrder,
      lessonOrder: lessons.sortOrder,
      status: learnerLessonProgress.status,
      updatedAt: learnerLessonProgress.updatedAt,
      completedAt: learnerLessonProgress.completedAt,
    })
    .from(lessons)
    .innerJoin(units, eq(units.id, lessons.unitId))
    .innerJoin(cefrLevels, eq(cefrLevels.code, units.level))
    .leftJoin(learnerLessonProgress, and(eq(learnerLessonProgress.lessonId, lessons.id), eq(learnerLessonProgress.userId, userId)))
    .where(and(eq(units.status, "published"), isNull(lessons.archivedAt)))
    .orderBy(asc(cefrLevels.sortOrder), asc(units.sortOrder), asc(lessons.sortOrder));
}

async function lessonStepFlags(db: DbExecutor, lessonIds: string[]) {
  if (lessonIds.length === 0) return new Map<string, { output: boolean; listening: boolean }>();
  const rows = await db
    .select({
      lessonId: lessonSteps.lessonId,
      output: sql<boolean>`bool_or(${lessonSteps.skill} in (${sql.join(OUTPUT_SKILLS.map((s) => sql`${s}`), sql`, `)}))`,
      listening: sql<boolean>`bool_or(${lessonSteps.skill} = 'listening')`,
    })
    .from(lessonSteps)
    .where(and(inArray(lessonSteps.lessonId, lessonIds), isNull(lessonSteps.archivedAt)))
    .groupBy(lessonSteps.lessonId);
  return new Map(rows.map((r) => [r.lessonId, { output: r.output, listening: r.listening }]));
}

/**
 * Placement level used to choose where to start: the lower of the vocabulary
 * and grammar estimates (the foundation the courses build on).
 */
export function placementLevel(estimates: { skill: string; level: string }[]): string | null {
  const relevant = estimates.filter((e) => e.skill === "vocabulary" || e.skill === "grammar");
  if (relevant.length === 0) return null;
  const idx = Math.min(...relevant.map((e) => Math.max(0, PLACEMENT_LEVELS.indexOf(e.level as never))));
  return PLACEMENT_LEVELS[idx]!;
}

/** Last time the learner studied anything before `before`. */
async function lastActivityBefore(db: DbExecutor, userId: string, before: Date): Promise<Date | null> {
  const iso = before.toISOString();
  const [row] = await db.execute<{ last: string | null }>(sql`
    select max(t) as last from (
      select max(reviewed_at) as t from review_logs where user_id = ${userId} and reviewed_at < ${iso}::timestamptz
      union all
      select max(created_at) from lesson_step_attempts where user_id = ${userId} and created_at < ${iso}::timestamptz
      union all
      select max(created_at) from content_interactions where user_id = ${userId} and kind <> 'open' and created_at < ${iso}::timestamptz
      union all
      select max(a.created_at) from assessment_attempts a join assessment_sessions s on s.id = a.session_id
        where s.user_id = ${userId} and a.created_at < ${iso}::timestamptz
    ) x
  `);
  return row?.last ? new Date(row.last) : null;
}

export type PlanContext = {
  timeZone: string;
  dayStart: Date;
  planDate: string;
  defaultMinutes: SessionLength;
  newItemsLimit: number;
};

async function gatherFacts(
  db: DbExecutor,
  userId: string,
  now: Date,
  ctx: PlanContext,
  sessionMinutes: SessionLength,
  mode: "normal" | "review_only",
  comeback: boolean,
) {
  // Alternate reading and listening from day to day.
  const preferType = Number(ctx.planDate.slice(-2)) % 2 === 0 ? "reading" : "listening";
  const [queue, all, estimates, inputMaterial, errors] = await Promise.all([
    getReviewQueue(db, userId, now, ctx.timeZone, ctx.newItemsLimit),
    loadPublishedLessons(db, userId),
    getCurrentEstimates(db, userId),
    pickInputMaterial(db, userId, preferType),
    errorSummary(db, userId, now),
  ]);
  // Only errors with an exercise bank behind them get a plan task: a due retest first, then the most frequent.
  const retest = errors.retestDue.filter((e) => e.canPractise).sort((a, b) => (a.retestDueAt?.getTime() ?? 0) - (b.retestDueAt?.getTime() ?? 0))[0];
  const fix = errors.needsRemediation.filter((e) => e.canPractise).sort((a, b) => b.occurrenceCount - a.occurrenceCount)[0];
  const pick = retest ?? fix;
  const remediation = pick
    ? {
        itemId: pick.id,
        title: pick.title,
        categoryLabel: ERROR_CATEGORY_LABELS[pick.category as keyof typeof ERROR_CATEGORY_LABELS] ?? pick.category,
        count: pick.occurrenceCount,
        mode: retest ? ("retest" as const) : ("remediation" as const),
      }
    : null;
  const flags = await lessonStepFlags(
    db,
    all.map((l) => l.id),
  );

  const toRef = (l: LessonRow): LessonRef => ({
    id: l.id,
    titleEn: l.titleEn,
    titleZh: l.titleZh,
    unitTitleEn: l.unitTitleEn,
    unitOrder: l.unitOrder,
    levelLabel: l.levelLabel,
    estimatedMinutes: l.estimatedMinutes,
    inProgress: l.status === "in_progress",
    hasOutputTask: flags.get(l.id)?.output ?? false,
  });

  const started = all.some((l) => l.status !== null);
  const placement = placementLevel(estimates);
  const levelOrder = (level: string) => CEFR_LEVELS.indexOf(level as never);
  // Start at the placement level, or at the highest level that has lessons if content doesn't reach that far yet.
  const highestOpen = Math.max(-1, ...all.filter((l) => l.status !== "completed").map((l) => levelOrder(l.level)));
  const placementOrder = placement ? Math.min(levelOrder(placement), highestOpen) : -1;
  const inProgress = all
    .filter((l) => l.status === "in_progress")
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))[0];
  const open = all.filter((l) => l.status !== "completed");
  // Before any lesson is started, honour the placement estimate (no hard locks: earlier units stay open).
  const placed =
    !started && placement ? open.find((l) => levelOrder(l.level) >= placementOrder) : undefined;
  // Otherwise continue after the furthest completed lesson; fall back to the first open one.
  const lastDoneIndex = all.findLastIndex((l) => l.status === "completed");
  const after = all.slice(lastDoneIndex + 1).find((l) => l.status !== "completed");
  const next = inProgress ?? placed ?? after ?? open[0] ?? null;

  const completed = all
    .filter((l) => l.status === "completed" && l.id !== next?.id)
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  const input = completed.find((l) => flags.get(l.id)?.listening);
  const output = completed.find((l) => flags.get(l.id)?.output && l.id !== input?.id);

  return {
    sessionMinutes,
    mode,
    comeback,
    dueReviews: queue.cards.filter((c) => !c.isNew).length,
    newCardsAvailable: queue.cards.filter((c) => c.isNew).length,
    nextLesson: next ? toRef(next) : null,
    inputMaterial,
    inputLesson: input ? toRef(input) : null,
    remediation,
    outputLesson: output ? toRef(output) : null,
    startingLevelLabel: !started && placed ? placed.levelLabel : null,
  };
}

async function planContext(db: DbExecutor, userId: string, now: Date, defaultTimeZone?: string): Promise<PlanContext> {
  const { profile, preferences } = await getLearnerSettings(db, userId, defaultTimeZone);
  const timeZone = profile.timezone;
  return {
    timeZone,
    dayStart: startOfLocalDay(now, timeZone),
    planDate: localDateString(now, timeZone),
    defaultMinutes: isSessionLength(preferences.dailyMinutes) ? preferences.dailyMinutes : 25,
    newItemsLimit: preferences.newItemsLimit,
  };
}

/** Where the learner would start right now (onboarding summary). */
export async function previewStartingPoint(db: DbExecutor, userId: string, now = new Date()) {
  const ctx = await planContext(db, userId, now);
  const facts = await gatherFacts(db, userId, now, ctx, ctx.defaultMinutes, "normal", false);
  return { nextLesson: facts.nextLesson, startingLevelLabel: facts.startingLevelLabel, sessionMinutes: ctx.defaultMinutes };
}

// ------------------------------------------------------------ persistence ----

async function insertTasks(db: DbExecutor, planId: string, tasks: PlannedTask[], keepSkipped: Map<string, string | null>) {
  if (tasks.length === 0) return;
  await db.insert(studyPlanTasks).values(
    tasks.map((t, i) => {
      const key = `${t.kind}:${t.targetId ?? ""}`;
      return {
        planId,
        kind: t.kind,
        title: t.title,
        href: t.href,
        minutes: t.minutes,
        reason: t.reason,
        targetId: t.targetId,
        sortOrder: i,
        status: keepSkipped.has(key) ? "skipped" : "pending",
        skipReason: keepSkipped.get(key) ?? null,
      };
    }),
  );
}

/**
 * Create today's plan if it doesn't exist yet. Concurrent first visits are
 * safe: the (user, date) unique key decides, the loser just reads.
 */
export async function ensureTodayPlan(db: Database, userId: string, now = new Date(), defaultTimeZone?: string) {
  const ctx = await planContext(db, userId, now, defaultTimeZone);
  const [existing] = await db
    .select({ id: studyPlans.id })
    .from(studyPlans)
    .where(and(eq(studyPlans.userId, userId), eq(studyPlans.planDate, ctx.planDate)));
  if (existing) return { planId: existing.id, ctx };

  const comeback = isComeback(await lastActivityBefore(db, userId, ctx.dayStart), now);
  const facts = await gatherFacts(db, userId, now, ctx, ctx.defaultMinutes, "normal", comeback);
  const tasks = buildPlan(facts);
  const planId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(studyPlans)
      .values({ userId, planDate: ctx.planDate, sessionMinutes: ctx.defaultMinutes, mode: "normal", comeback })
      .onConflictDoNothing()
      .returning({ id: studyPlans.id });
    if (!created) return null;
    await insertTasks(tx, created.id, tasks, new Map());
    return created.id;
  });
  if (planId) return { planId, ctx };
  const [winner] = await db
    .select({ id: studyPlans.id })
    .from(studyPlans)
    .where(and(eq(studyPlans.userId, userId), eq(studyPlans.planDate, ctx.planDate)));
  return { planId: winner!.id, ctx };
}

/**
 * Rebuild today's plan with a new length or mode (or fresh facts). Tasks the
 * learner skipped stay skipped, with their reason.
 */
export async function regenerateTodayPlan(
  db: Database,
  userId: string,
  options: { sessionMinutes?: SessionLength; mode?: "normal" | "review_only" },
  now = new Date(),
) {
  const { planId, ctx } = await ensureTodayPlan(db, userId, now);
  const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.id, planId));
  const sessionMinutes = options.sessionMinutes ?? (isSessionLength(plan!.sessionMinutes) ? plan!.sessionMinutes : ctx.defaultMinutes);
  const mode = options.mode ?? (plan!.mode as "normal" | "review_only");
  const facts = await gatherFacts(db, userId, now, ctx, sessionMinutes, mode, plan!.comeback);
  const tasks = buildPlan(facts);
  await db.transaction(async (tx) => {
    const old = await tx.select().from(studyPlanTasks).where(eq(studyPlanTasks.planId, planId));
    const skipped = new Map(old.filter((t) => t.status === "skipped").map((t) => [`${t.kind}:${t.targetId ?? ""}`, t.skipReason]));
    await tx.delete(studyPlanTasks).where(eq(studyPlanTasks.planId, planId));
    await tx.update(studyPlans).set({ sessionMinutes, mode }).where(eq(studyPlans.id, planId));
    await insertTasks(tx, planId, tasks, skipped);
  });
}

async function getOwnedTask(db: DbExecutor, userId: string, taskId: string) {
  const [row] = await db
    .select({ task: studyPlanTasks })
    .from(studyPlanTasks)
    .innerJoin(studyPlans, eq(studyPlans.id, studyPlanTasks.planId))
    .where(and(eq(studyPlanTasks.id, taskId), eq(studyPlans.userId, userId)));
  if (!row) throw new PlanTaskNotFoundError(taskId);
  return row.task;
}

/** Move a task one place up or down (swap with its neighbour). */
export async function moveTask(db: Database, userId: string, taskId: string, direction: "up" | "down") {
  await db.transaction(async (tx) => {
    const task = await getOwnedTask(tx, userId, taskId);
    const siblings = await tx
      .select({ id: studyPlanTasks.id, sortOrder: studyPlanTasks.sortOrder })
      .from(studyPlanTasks)
      .where(eq(studyPlanTasks.planId, task.planId))
      .orderBy(asc(studyPlanTasks.sortOrder), asc(studyPlanTasks.createdAt));
    const i = siblings.findIndex((s) => s.id === taskId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= siblings.length) return;
    [siblings[i], siblings[j]] = [siblings[j]!, siblings[i]!];
    for (const [order, s] of siblings.entries()) {
      await tx.update(studyPlanTasks).set({ sortOrder: order }).where(eq(studyPlanTasks.id, s.id));
    }
  });
}

export async function skipTask(db: DbExecutor, userId: string, taskId: string, reason: SkipReason) {
  await getOwnedTask(db, userId, taskId);
  await db.update(studyPlanTasks).set({ status: "skipped", skipReason: reason }).where(eq(studyPlanTasks.id, taskId));
}

export async function restoreTask(db: DbExecutor, userId: string, taskId: string) {
  await getOwnedTask(db, userId, taskId);
  await db.update(studyPlanTasks).set({ status: "pending", skipReason: null }).where(eq(studyPlanTasks.id, taskId));
}

// ------------------------------------------------------------------- view ----

export type TodayTask = {
  id: string;
  kind: PlannedTask["kind"];
  title: string;
  href: string;
  minutes: number;
  reason: string;
  status: "pending" | "skipped" | "done";
  skipReason: SkipReason | null;
};

export type TodayPlan = {
  planDate: string;
  sessionMinutes: SessionLength;
  mode: "normal" | "review_only";
  comeback: boolean;
  tasks: TodayTask[];
  dueReviews: number;
  reviewsToday: number;
};

/** Today's plan with "done" worked out from today's activity. */
export async function getTodayPlan(db: Database, userId: string, now = new Date(), defaultTimeZone?: string): Promise<TodayPlan> {
  const { planId, ctx } = await ensureTodayPlan(db, userId, now, defaultTimeZone);
  const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.id, planId));
  const rows = await db
    .select()
    .from(studyPlanTasks)
    .where(eq(studyPlanTasks.planId, planId))
    .orderBy(asc(studyPlanTasks.sortOrder), asc(studyPlanTasks.createdAt));

  const lessonIds = rows.flatMap((t) => (t.targetId ? [t.targetId] : []));
  const remediationIds = rows.filter((t) => t.kind === "remediation" && t.targetId).map((t) => t.targetId!);
  const [queue, [reviewed], completedToday, practisedToday, materialsDone, remediationItems] = await Promise.all([
    getReviewQueue(db, userId, now, ctx.timeZone, ctx.newItemsLimit),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(reviewLogs)
      .where(and(eq(reviewLogs.userId, userId), gte(reviewLogs.reviewedAt, ctx.dayStart))),
    lessonIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ lessonId: learnerLessonProgress.lessonId })
          .from(learnerLessonProgress)
          .where(
            and(
              eq(learnerLessonProgress.userId, userId),
              inArray(learnerLessonProgress.lessonId, lessonIds),
              gte(learnerLessonProgress.completedAt, ctx.dayStart),
            ),
          ),
    lessonIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            lessonId: lessonStepAttempts.lessonId,
            skill: lessonSteps.skill,
            at: sql<string>`max(${lessonStepAttempts.createdAt})`.mapWith((v: string) => new Date(v)),
          })
          .from(lessonStepAttempts)
          .innerJoin(lessonSteps, and(eq(lessonSteps.lessonId, lessonStepAttempts.lessonId), eq(lessonSteps.stepKey, lessonStepAttempts.stepKey)))
          .where(
            and(
              eq(lessonStepAttempts.userId, userId),
              inArray(lessonStepAttempts.lessonId, lessonIds),
              gte(lessonStepAttempts.createdAt, ctx.dayStart),
            ),
          )
          .groupBy(lessonStepAttempts.lessonId, lessonSteps.skill),
    lessonIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ contentId: contentInteractions.contentId, at: sql<string>`max(${contentInteractions.createdAt})`.mapWith((v: string) => new Date(v)) })
          .from(contentInteractions)
          .where(
            and(
              eq(contentInteractions.userId, userId),
              eq(contentInteractions.kind, "complete"),
              inArray(contentInteractions.contentId, lessonIds),
              gte(contentInteractions.createdAt, ctx.dayStart),
            ),
          )
          .groupBy(contentInteractions.contentId),
    remediationIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: errorItems.id, status: errorItems.status, remediationPassedAt: errorItems.remediationPassedAt, resolvedAt: errorItems.resolvedAt, updatedAt: errorItems.updatedAt })
          .from(errorItems)
          .where(and(eq(errorItems.userId, userId), inArray(errorItems.id, remediationIds))),
  ]);
  const dueReviews = queue.cards.filter((c) => !c.isNew).length;
  const reviewsToday = reviewed?.n ?? 0;
  const completed = new Set(completedToday.map((r) => r.lessonId));

  const isDone = (t: (typeof rows)[number]) => {
    switch (t.kind) {
      case "review":
        return reviewsToday > 0 && queue.cards.length === 0;
      case "lesson":
        return t.targetId !== null && completed.has(t.targetId);
      // Practice counts only once the task was recommended (not earlier the same day).
      case "input":
        if (t.href.startsWith("/reading/") || t.href.startsWith("/listening/")) {
          return materialsDone.some((m) => m.contentId === t.targetId && m.at >= t.createdAt);
        }
        return practisedToday.some((p) => p.lessonId === t.targetId && p.skill === "listening" && p.at >= t.createdAt);
      case "remediation": {
        const item = remediationItems.find((i) => i.id === t.targetId);
        if (!item) return false;
        if (t.title.startsWith("换个语境再测")) return item.status !== "retest" && item.updatedAt >= t.createdAt;
        return item.status !== "active" && ((item.remediationPassedAt ?? item.resolvedAt ?? new Date(0)) >= t.createdAt);
      }
      case "output":
        return practisedToday.some((p) => p.lessonId === t.targetId && OUTPUT_SKILLS.includes(p.skill) && p.at >= t.createdAt);
      default:
        return false;
    }
  };

  return {
    planDate: plan!.planDate,
    sessionMinutes: isSessionLength(plan!.sessionMinutes) ? plan!.sessionMinutes : ctx.defaultMinutes,
    mode: plan!.mode as TodayPlan["mode"],
    comeback: plan!.comeback,
    dueReviews,
    reviewsToday,
    tasks: rows.map((t) => ({
      id: t.id,
      kind: t.kind as TodayTask["kind"],
      title: t.title,
      href: t.href,
      minutes: t.minutes,
      reason: t.reason,
      status: isDone(t) ? "done" : (t.status as "pending" | "skipped"),
      skipReason: (t.skipReason as SkipReason | null) ?? null,
    })),
  };
}

/** Whether the learner has ever answered a diagnostic item (used for gentle prompts). */
export async function hasTakenDiagnostic(db: DbExecutor, userId: string) {
  const [row] = await db
    .select({ id: assessmentSessions.id })
    .from(assessmentSessions)
    .where(and(eq(assessmentSessions.userId, userId), eq(assessmentSessions.status, "completed")))
    .orderBy(desc(assessmentSessions.completedAt))
    .limit(1);
  return Boolean(row);
}

