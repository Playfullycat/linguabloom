import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/connection";
import {
  cefrLevels,
  learnerLessonProgress,
  lessonStepAttempts,
  lessonSteps,
  lessons,
  units,
} from "@/db/schema";

import type { LessonStepContent, UnitFile } from "../content/schema";
import { toClientStep, type ClientStep } from "../domain/client-step";
import type { CefrLevel } from "../domain/cefr";

/**
 * Read models for the learning path pages. Every learner-specific query is
 * filtered by `userId` (spec §7.3: scope all data to the current owner).
 */

export type UnitContent = Pick<UnitFile["unit"], "can_do" | "grammar_points" | "vocabulary">;
export type LessonProgressStatus = "not_started" | "in_progress" | "completed";

export type LevelOverview = {
  code: CefrLevel;
  label: string;
  stageGoalZh: string;
  focusZh: string;
  unitCount: number;
  publishedUnitCount: number;
  lessonCount: number;
  completedLessonCount: number;
};

export async function listLevels(db: DbExecutor, userId: string): Promise<LevelOverview[]> {
  const levelRows = await db.select().from(cefrLevels).orderBy(asc(cefrLevels.sortOrder));

  const unitCounts = await db
    .select({
      level: units.level,
      total: sql<number>`count(*)::int`,
      published: sql<number>`count(*) filter (where ${units.status} = 'published')::int`,
    })
    .from(units)
    .where(inArray(units.status, ["planned", "draft", "published"]))
    .groupBy(units.level);

  const lessonCounts = await db
    .select({
      level: units.level,
      total: sql<number>`count(${lessons.id})::int`,
      completed: sql<number>`count(${learnerLessonProgress.lessonId}) filter (where ${learnerLessonProgress.status} = 'completed')::int`,
    })
    .from(lessons)
    .innerJoin(units, eq(units.id, lessons.unitId))
    .leftJoin(
      learnerLessonProgress,
      and(eq(learnerLessonProgress.lessonId, lessons.id), eq(learnerLessonProgress.userId, userId)),
    )
    .where(and(eq(units.status, "published"), isNull(lessons.archivedAt)))
    .groupBy(units.level);

  return levelRows.map((level) => {
    const u = unitCounts.find((r) => r.level === level.code);
    const l = lessonCounts.find((r) => r.level === level.code);
    return {
      code: level.code as CefrLevel,
      label: level.label,
      stageGoalZh: level.stageGoalZh,
      focusZh: level.focusZh,
      unitCount: u?.total ?? 0,
      publishedUnitCount: u?.published ?? 0,
      lessonCount: l?.total ?? 0,
      completedLessonCount: l?.completed ?? 0,
    };
  });
}

export type UnitSummary = {
  id: string;
  order: number;
  titleEn: string;
  titleZh: string;
  summaryZh: string;
  status: "planned" | "draft" | "published";
  lessonCount: number;
  completedLessonCount: number;
};

export async function getLevel(db: DbExecutor, userId: string, level: string) {
  const [levelRow] = await db.select().from(cefrLevels).where(eq(cefrLevels.code, level)).limit(1);
  if (!levelRow) return null;

  const rows = await db
    .select({
      id: units.id,
      order: units.sortOrder,
      titleEn: units.titleEn,
      titleZh: units.titleZh,
      summaryZh: units.summaryZh,
      status: units.status,
      lessonCount: sql<number>`count(${lessons.id})::int`,
      completedLessonCount: sql<number>`count(${learnerLessonProgress.lessonId}) filter (where ${learnerLessonProgress.status} = 'completed')::int`,
    })
    .from(units)
    .leftJoin(lessons, and(eq(lessons.unitId, units.id), isNull(lessons.archivedAt)))
    .leftJoin(
      learnerLessonProgress,
      and(eq(learnerLessonProgress.lessonId, lessons.id), eq(learnerLessonProgress.userId, userId)),
    )
    .where(and(eq(units.level, level), inArray(units.status, ["planned", "draft", "published"])))
    .groupBy(units.id)
    .orderBy(asc(units.sortOrder));

  return {
    code: levelRow.code as CefrLevel,
    label: levelRow.label,
    stageGoalZh: levelRow.stageGoalZh,
    focusZh: levelRow.focusZh,
    units: rows as UnitSummary[],
  };
}

export type LessonSummary = {
  id: string;
  order: number;
  kind: "core" | "review";
  titleEn: string;
  titleZh: string;
  estimatedMinutes: number;
  status: LessonProgressStatus;
  completionRatio: number;
  masteryEstimate: number | null;
};

export async function getUnit(db: DbExecutor, userId: string, unitId: string) {
  const [unit] = await db.select().from(units).where(eq(units.id, unitId)).limit(1);
  if (!unit || unit.status === "archived") return null;

  const lessonRows = await db
    .select({
      id: lessons.id,
      order: lessons.sortOrder,
      kind: lessons.kind,
      titleEn: lessons.titleEn,
      titleZh: lessons.titleZh,
      estimatedMinutes: lessons.estimatedMinutes,
      status: learnerLessonProgress.status,
      completionRatio: learnerLessonProgress.completionRatio,
      masteryEstimate: learnerLessonProgress.masteryEstimate,
    })
    .from(lessons)
    .leftJoin(
      learnerLessonProgress,
      and(eq(learnerLessonProgress.lessonId, lessons.id), eq(learnerLessonProgress.userId, userId)),
    )
    .where(and(eq(lessons.unitId, unitId), isNull(lessons.archivedAt)))
    .orderBy(asc(lessons.sortOrder));

  const [levelRow] = await db.select({ label: cefrLevels.label }).from(cefrLevels).where(eq(cefrLevels.code, unit.level));

  return {
    id: unit.id,
    level: unit.level as CefrLevel,
    levelLabel: levelRow?.label ?? unit.level,
    order: unit.sortOrder,
    titleEn: unit.titleEn,
    titleZh: unit.titleZh,
    summaryZh: unit.summaryZh,
    status: unit.status as UnitSummary["status"],
    reviewStatus: unit.reviewStatus,
    content: (unit.content as UnitContent | null) ?? null,
    lessons: lessonRows.map(
      (l): LessonSummary => ({
        id: l.id,
        order: l.order,
        kind: l.kind as LessonSummary["kind"],
        titleEn: l.titleEn,
        titleZh: l.titleZh,
        estimatedMinutes: l.estimatedMinutes,
        status: (l.status ?? "not_started") as LessonProgressStatus,
        completionRatio: l.completionRatio ?? 0,
        masteryEstimate: l.masteryEstimate,
      }),
    ),
  };
}

export type PreviousAttempt = {
  attemptCount: number;
  lastIsCorrect: boolean | null;
};

export type PlayerLesson = {
  id: string;
  unitId: string;
  unitTitleEn: string;
  unitTitleZh: string;
  levelLabel: string;
  titleEn: string;
  titleZh: string;
  kind: "core" | "review";
  estimatedMinutes: number;
  objectives: { en: string; zh: string }[];
  steps: (ClientStep & { assessed: boolean })[];
  vocabulary: UnitContent["vocabulary"];
  grammarPoints: UnitContent["grammar_points"];
  progress: { status: LessonProgressStatus; currentStepKey: string | null };
  attempts: Record<string, PreviousAttempt>;
  nextLessonId: string | null;
};

/** Everything the lesson player needs, without answer keys. Published units only. */
export async function getLessonForPlayer(db: DbExecutor, userId: string, lessonId: string): Promise<PlayerLesson | null> {
  const [row] = await db
    .select({ lesson: lessons, unit: units, levelLabel: cefrLevels.label })
    .from(lessons)
    .innerJoin(units, eq(units.id, lessons.unitId))
    .innerJoin(cefrLevels, eq(cefrLevels.code, units.level))
    .where(and(eq(lessons.id, lessonId), isNull(lessons.archivedAt), eq(units.status, "published")))
    .limit(1);
  if (!row) return null;

  const stepRows = await db
    .select({ stepKey: lessonSteps.stepKey, content: lessonSteps.content, assessed: lessonSteps.assessed })
    .from(lessonSteps)
    .where(and(eq(lessonSteps.lessonId, lessonId), isNull(lessonSteps.archivedAt)))
    .orderBy(asc(lessonSteps.sortOrder));

  const [progress] = await db
    .select()
    .from(learnerLessonProgress)
    .where(and(eq(learnerLessonProgress.userId, userId), eq(learnerLessonProgress.lessonId, lessonId)))
    .limit(1);

  const attemptRows = await db
    .select({
      stepKey: lessonStepAttempts.stepKey,
      count: sql<number>`count(*)::int`,
      lastIsCorrect: sql<boolean | null>`(array_agg(${lessonStepAttempts.isCorrect} order by ${lessonStepAttempts.createdAt} desc))[1]`,
    })
    .from(lessonStepAttempts)
    .where(and(eq(lessonStepAttempts.userId, userId), eq(lessonStepAttempts.lessonId, lessonId)))
    .groupBy(lessonStepAttempts.stepKey);

  const [next] = await db
    .select({ id: lessons.id })
    .from(lessons)
    .where(and(eq(lessons.unitId, row.unit.id), isNull(lessons.archivedAt), sql`${lessons.sortOrder} > ${row.lesson.sortOrder}`))
    .orderBy(asc(lessons.sortOrder))
    .limit(1);

  const content = (row.unit.content as UnitContent | null) ?? { can_do: [], grammar_points: [], vocabulary: [] };

  return {
    id: row.lesson.id,
    unitId: row.unit.id,
    unitTitleEn: row.unit.titleEn,
    unitTitleZh: row.unit.titleZh,
    levelLabel: row.levelLabel,
    titleEn: row.lesson.titleEn,
    titleZh: row.lesson.titleZh,
    kind: row.lesson.kind as PlayerLesson["kind"],
    estimatedMinutes: row.lesson.estimatedMinutes,
    objectives: row.lesson.objectives as PlayerLesson["objectives"],
    steps: stepRows.map((s) => ({
      ...toClientStep(s.content as LessonStepContent, `${lessonId}.${s.stepKey}`),
      assessed: s.assessed,
    })),
    vocabulary: content.vocabulary,
    grammarPoints: content.grammar_points,
    progress: {
      status: (progress?.status ?? "not_started") as LessonProgressStatus,
      currentStepKey: progress?.currentStepKey ?? null,
    },
    attempts: Object.fromEntries(attemptRows.map((a) => [a.stepKey, { attemptCount: a.count, lastIsCorrect: a.lastIsCorrect }])),
    nextLessonId: next?.id ?? null,
  };
}
