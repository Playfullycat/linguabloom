import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/connection";
import { cefrLevels, errorItems, exerciseAttempts, exercises, grammarPoints, units, type ErrorCategory } from "@/db/schema";
import { refreshPracticeEstimate } from "@/modules/assessment/services/practice-estimates";
import { CEFR_LEVEL_LABELS, isCefrLevel } from "@/modules/curriculum/domain/cefr";
import { errorsForGrammarPoint, recordError } from "@/modules/errors/services/errors";

import type { BreakdownRole } from "../content";
import { scoreExercise, type AnswerKey, type ExerciseEvaluation, type ExercisePrompt } from "../domain/scoring";

/**
 * Grammar Studio (spec §5.5): the grammar map with each learner's progress,
 * grammar point pages and exercises scored on the server.
 */

export class GrammarNotFoundError extends Error {}

export type GrammarContent = {
  summary_zh: string;
  explanation_zh: string | null;
  structure: string[];
  usage_zh: string[];
  examples: { en: string; zh: string }[];
  breakdowns: { zh: string; parts: { text: string; role: BreakdownRole }[] }[];
  common_errors: { wrong: string; right: string; why_zh: string }[];
  contrast: { title_zh: string; items: { en: string; zh: string; note_zh: string }[] } | null;
  limits_zh: string[];
};

export type Mastery = "planned" | "not_started" | "practising" | "mastered" | "weak";
export const MASTERY_LABELS: Record<Mastery, string> = {
  planned: "规划中",
  not_started: "未开始",
  practising: "练习中",
  mastered: "掌握得不错",
  weak: "需要加强",
};

/** Last 10 scored attempts at the point's exercises decide "practising" vs "mastered". */
const MASTERY_WINDOW = 10;
const MASTERY_MIN = 5;
const MASTERY_PASS = 0.8;

async function masteryByPoint(db: DbExecutor, userId: string, pointIds: string[]) {
  if (pointIds.length === 0) return new Map<string, { attempts: number; accuracy: number | null; activeErrors: number }>();
  const recent = await db.execute<{ point: string; attempts: number; correct: number }>(sql`
    select point, count(*)::int as attempts, count(*) filter (where is_correct)::int as correct
    from (
      select e.grammar_point_id as point, a.is_correct,
             row_number() over (partition by e.grammar_point_id order by a.created_at desc) as rn
      from exercise_attempts a join exercises e on e.id = a.exercise_id
      where a.user_id = ${userId} and a.is_correct is not null
    ) x
    where rn <= ${MASTERY_WINDOW}
    group by point
  `);
  const errors = await db
    .select({ point: errorItems.pointId, n: sql<number>`count(*)::int` })
    .from(errorItems)
    .where(and(eq(errorItems.userId, userId), eq(errorItems.pointType, "grammar"), sql`${errorItems.status} <> 'resolved'`))
    .groupBy(errorItems.pointId);
  const map = new Map<string, { attempts: number; accuracy: number | null; activeErrors: number }>();
  for (const id of pointIds) {
    const r = [...recent].find((x) => x.point === id);
    map.set(id, {
      attempts: r?.attempts ?? 0,
      accuracy: r && r.attempts > 0 ? r.correct / r.attempts : null,
      activeErrors: errors.find((e) => e.point === id)?.n ?? 0,
    });
  }
  return map;
}

function masteryOf(status: string, m: { attempts: number; accuracy: number | null; activeErrors: number } | undefined): Mastery {
  if (status === "planned") return "planned";
  if (!m || (m.attempts === 0 && m.activeErrors === 0)) return "not_started";
  if (m.activeErrors > 0) return "weak";
  if (m.attempts >= MASTERY_MIN && (m.accuracy ?? 0) >= MASTERY_PASS) return "mastered";
  return "practising";
}

export type GrammarMapItem = {
  id: string;
  order: number;
  level: string;
  levelLabel: string;
  titleEn: string;
  titleZh: string;
  summaryZh: string;
  status: "published" | "planned";
  topics: string[];
  prerequisites: { id: string; titleZh: string; mastery: Mastery }[];
  mastery: Mastery;
  attempts: number;
  accuracy: number | null;
  exerciseCount: number;
};

export async function listGrammarPoints(db: DbExecutor, userId: string): Promise<GrammarMapItem[]> {
  const points = await db.select().from(grammarPoints).where(isNull(grammarPoints.archivedAt)).orderBy(asc(grammarPoints.sortOrder));
  const counts = await db
    .select({ point: exercises.grammarPointId, n: sql<number>`count(*)::int` })
    .from(exercises)
    .where(isNull(exercises.archivedAt))
    .groupBy(exercises.grammarPointId);
  const mastery = await masteryByPoint(
    db,
    userId,
    points.map((p) => p.id),
  );
  const masteryOfId = (id: string) => {
    const p = points.find((x) => x.id === id);
    return p ? masteryOf(p.status, mastery.get(id)) : "not_started";
  };
  return points.map((p) => {
    const m = mastery.get(p.id);
    return {
      id: p.id,
      order: p.sortOrder,
      level: p.level,
      levelLabel: isCefrLevel(p.level) ? CEFR_LEVEL_LABELS[p.level] : p.level,
      titleEn: p.titleEn,
      titleZh: p.titleZh,
      summaryZh: (p.content as GrammarContent).summary_zh,
      status: p.status as "published" | "planned",
      topics: p.topics,
      prerequisites: p.prerequisiteIds.map((id) => ({ id, titleZh: points.find((x) => x.id === id)?.titleZh ?? id, mastery: masteryOfId(id) })),
      mastery: masteryOf(p.status, m),
      attempts: m?.attempts ?? 0,
      accuracy: m?.accuracy ?? null,
      exerciseCount: counts.find((c) => c.point === p.id)?.n ?? 0,
    };
  });
}

export type ClientExercise = { id: string; type: ExercisePrompt["type"]; difficulty: number; prompt: ExercisePrompt };

export async function clientExercises(db: DbExecutor, ids: string[]): Promise<ClientExercise[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: exercises.id, type: exercises.exerciseType, difficulty: exercises.difficulty, prompt: exercises.prompt })
    .from(exercises)
    .where(and(inArray(exercises.id, ids), isNull(exercises.archivedAt)));
  return ids.flatMap((id) => {
    const r = rows.find((x) => x.id === id);
    return r ? [{ id: r.id, type: r.type as ExercisePrompt["type"], difficulty: r.difficulty, prompt: r.prompt as ExercisePrompt }] : [];
  });
}

export async function getGrammarPoint(db: DbExecutor, userId: string, id: string) {
  const [point] = await db
    .select()
    .from(grammarPoints)
    .where(and(eq(grammarPoints.id, id), isNull(grammarPoints.archivedAt)));
  if (!point) throw new GrammarNotFoundError(id);
  const all = await listGrammarPoints(db, userId);
  const self = all.find((p) => p.id === id)!;

  // Units that teach it: their content lists grammar points by id.
  const taughtIn = point.unitGrammarIds.length
    ? await db
        .select({ id: units.id, titleEn: units.titleEn, titleZh: units.titleZh, level: units.level, levelLabel: cefrLevels.label, order: units.sortOrder })
        .from(units)
        .innerJoin(cefrLevels, eq(cefrLevels.code, units.level))
        .where(
          and(
            eq(units.status, "published"),
            sql`exists (select 1 from jsonb_array_elements(${units.content}->'grammar_points') g where g->>'id' in (${sql.join(point.unitGrammarIds.map((u) => sql`${u}`), sql`, `)}))`,
          ),
        )
        .orderBy(asc(cefrLevels.sortOrder), asc(units.sortOrder))
    : [];

  const exerciseRows = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(eq(exercises.grammarPointId, id), isNull(exercises.archivedAt)))
    .orderBy(asc(exercises.sortOrder));
  const lastAttempts = exerciseRows.length
    ? await db
        .selectDistinctOn([exerciseAttempts.exerciseId], { exerciseId: exerciseAttempts.exerciseId, isCorrect: exerciseAttempts.isCorrect, score: exerciseAttempts.score })
        .from(exerciseAttempts)
        .where(and(eq(exerciseAttempts.userId, userId), inArray(exerciseAttempts.exerciseId, exerciseRows.map((e) => e.id))))
        .orderBy(exerciseAttempts.exerciseId, desc(exerciseAttempts.createdAt))
    : [];

  return {
    point: self,
    content: point.content as GrammarContent,
    defaultErrorCategory: point.defaultErrorCategory,
    reviewStatus: point.reviewStatus,
    taughtIn,
    recentErrors: await errorsForGrammarPoint(db, userId, id, point.unitGrammarIds),
    exercises: await clientExercises(
      db,
      exerciseRows.map((e) => e.id),
    ),
    lastAttempts: Object.fromEntries(lastAttempts.map((a) => [a.exerciseId, { isCorrect: a.isCorrect, score: a.score }])),
    next: all.find((p) => p.order > self.order && p.status === "published") ?? null,
  };
}

export type ExerciseResult = ExerciseEvaluation & { explanationZh: string | null; duplicate: boolean; errorRecorded: boolean };

export type AnswerExerciseInput = {
  exerciseId: string;
  response: unknown;
  clientRequestId: string;
  context: "practice" | "remediation" | "retest";
  errorItemId?: string;
  durationMs?: number;
};

/**
 * Score one exercise on the server and keep the attempt (append-only).
 * A wrong answer in normal practice goes into the error notebook; answers in
 * a remediation round or retest are judged by the round instead.
 */
export async function answerExercise(db: Database, userId: string, input: AnswerExerciseInput, now = new Date()): Promise<ExerciseResult> {
  const [ex] = await db
    .select({ exercise: exercises, pointTitle: grammarPoints.titleZh })
    .from(exercises)
    .leftJoin(grammarPoints, eq(grammarPoints.id, exercises.grammarPointId))
    .where(and(eq(exercises.id, input.exerciseId), isNull(exercises.archivedAt)));
  if (!ex) throw new GrammarNotFoundError(input.exerciseId);
  const e = ex.exercise;
  const evaluation = scoreExercise(e.prompt as ExercisePrompt, e.answerKey as AnswerKey, input.response);
  const explanationZh = (e.explanation as { zh: string | null }).zh;

  if (input.errorItemId) {
    const [owned] = await db.select({ id: errorItems.id }).from(errorItems).where(and(eq(errorItems.id, input.errorItemId), eq(errorItems.userId, userId)));
    if (!owned) throw new GrammarNotFoundError(input.errorItemId);
  }

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: exerciseAttempts.id })
      .from(exerciseAttempts)
      .where(and(eq(exerciseAttempts.clientRequestId, input.clientRequestId), eq(exerciseAttempts.userId, userId)));
    if (existing) return { duplicate: true, errorRecorded: false };
    await tx.insert(exerciseAttempts).values({
      userId,
      exerciseId: e.id,
      response: input.response as object,
      score: evaluation.score,
      isCorrect: evaluation.isCorrect,
      feedback: { correctAnswer: evaluation.correctAnswer },
      context: input.context,
      errorItemId: input.errorItemId ?? null,
      durationMs: input.durationMs ?? null,
      clientRequestId: input.clientRequestId,
      createdAt: now,
    });
    let errorRecorded = false;
    if (evaluation.isCorrect === false && input.context === "practice" && e.grammarPointId) {
      await recordError(
        tx,
        userId,
        {
          category: e.errorCategory as ErrorCategory,
          pointType: "grammar",
          pointId: e.grammarPointId,
          title: ex.pointTitle ?? e.grammarPointId,
          source: "grammar",
          sourceRef: e.id,
          wrong: evaluation.given,
          correct: evaluation.correctAnswer,
        },
        now,
      );
      errorRecorded = true;
    }
    return { duplicate: false, errorRecorded };
  });
  if (!result.duplicate && evaluation.isCorrect !== null) await refreshPracticeEstimate(db, userId, "grammar", now);
  return { ...evaluation, explanationZh, ...result };
}
