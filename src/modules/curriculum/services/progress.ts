import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db/connection";
import { learnerLessonProgress, lessonStepAttempts, lessonSteps, lessons } from "@/db/schema";

import type { LessonStepContent } from "../content/schema";
import { evaluateStep, type StepEvaluation } from "../domain/scoring";

/**
 * Lesson progress (spec §5.3): every completed step writes an append-only
 * attempt; progress keeps the resume point and completion ratio. Scoring
 * happens here, on the server, against the stored answer keys.
 */

export class LessonNotFoundError extends Error {}
export class LessonIncompleteError extends Error {
  constructor(public readonly missingStepKeys: string[]) {
    super(`Required steps not done yet: ${missingStepKeys.join(", ")}`);
  }
}

export type RecordAttemptInput = {
  lessonId: string;
  stepKey: string;
  response: unknown;
  clientRequestId: string;
  durationMs?: number;
};

export type RecordAttemptResult = StepEvaluation & {
  attemptNo: number;
  /** Retried request: the stored result was returned, nothing new was written. */
  duplicate: boolean;
  nextStepKey: string | null;
  completionRatio: number;
};

async function loadSteps(db: Database, lessonId: string) {
  return db
    .select({ stepKey: lessonSteps.stepKey, content: lessonSteps.content, assessed: lessonSteps.assessed })
    .from(lessonSteps)
    .innerJoin(lessons, eq(lessons.id, lessonSteps.lessonId))
    .where(and(eq(lessonSteps.lessonId, lessonId), isNull(lessonSteps.archivedAt), isNull(lessons.archivedAt)))
    .orderBy(asc(lessonSteps.sortOrder));
}

export async function recordStepAttempt(db: Database, userId: string, input: RecordAttemptInput): Promise<RecordAttemptResult> {
  const steps = await loadSteps(db, input.lessonId);
  const index = steps.findIndex((s) => s.stepKey === input.stepKey);
  if (index === -1) throw new LessonNotFoundError(`No step ${input.stepKey} in lesson ${input.lessonId}`);

  const step = steps[index]!;
  const content = step.content as LessonStepContent;
  // Validates the response shape (throws InvalidResponseError) before writing.
  const evaluation = evaluateStep(content, input.response);
  const nextStepKey = steps[index + 1]?.stepKey ?? null;

  return db.transaction(async (tx) => {
    // Idempotency: the same client request id returns the stored attempt.
    const [existing] = await tx
      .select()
      .from(lessonStepAttempts)
      .where(and(eq(lessonStepAttempts.clientRequestId, input.clientRequestId), eq(lessonStepAttempts.userId, userId)))
      .limit(1);

    let attemptNo: number;
    let duplicate = false;
    if (existing) {
      attemptNo = existing.attemptNo;
      duplicate = true;
    } else {
      // Serialise attempts for this learner+step so attempt numbers stay unique.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${userId}:${input.lessonId}:${input.stepKey}`}))`);
      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(lessonStepAttempts)
        .where(
          and(
            eq(lessonStepAttempts.userId, userId),
            eq(lessonStepAttempts.lessonId, input.lessonId),
            eq(lessonStepAttempts.stepKey, input.stepKey),
          ),
        )) as [{ count: number }];
      attemptNo = count + 1;
      await tx
        .insert(lessonStepAttempts)
        .values({
          userId,
          lessonId: input.lessonId,
          stepKey: input.stepKey,
          attemptNo,
          response: input.response as object,
          isCorrect: evaluation.isCorrect,
          selfScore: evaluation.selfScore,
          durationMs: input.durationMs ?? null,
          clientRequestId: input.clientRequestId,
        })
        .onConflictDoNothing({ target: lessonStepAttempts.clientRequestId });
    }

    const [{ done }] = (await tx
      .select({ done: sql<number>`count(distinct ${lessonStepAttempts.stepKey})::int` })
      .from(lessonStepAttempts)
      .where(and(eq(lessonStepAttempts.userId, userId), eq(lessonStepAttempts.lessonId, input.lessonId)))) as [{ done: number }];
    const completionRatio = Math.min(1, done / steps.length);

    await tx
      .insert(learnerLessonProgress)
      .values({
        userId,
        lessonId: input.lessonId,
        status: "in_progress",
        currentStepKey: nextStepKey ?? input.stepKey,
        completionRatio,
      })
      .onConflictDoUpdate({
        target: [learnerLessonProgress.userId, learnerLessonProgress.lessonId],
        set: {
          // A completed lesson stays completed when it is practised again.
          currentStepKey: nextStepKey ?? input.stepKey,
          completionRatio: sql`greatest(${learnerLessonProgress.completionRatio}, ${completionRatio})`,
        },
      });

    return { ...evaluation, attemptNo, duplicate, nextStepKey, completionRatio };
  });
}

export type LessonSummaryResult = {
  masteryEstimate: number | null;
  objectiveCount: number;
  firstTryCorrect: number;
  /** Objective steps answered wrong on the first try (worth reviewing). */
  toReview: { stepKey: string; skill: string; label: string; answer: string | null }[];
  /** Vocabulary keys introduced in this lesson. */
  vocabularyKeys: string[];
  openTasksDone: number;
};

/** The right answer, shown in the summary (the lesson is finished, so no spoilers). */
function stepAnswer(step: LessonStepContent): string | null {
  switch (step.type) {
    case "choice":
      return step.options[step.answer] ?? null;
    case "cloze":
      return step.sentence_en.replace("___", step.answers[0]!);
    case "order":
      return step.answers[0] ?? null;
    case "match":
      return step.pairs.map((p) => `${p.left} → ${p.right}`).join("；");
    default:
      return null;
  }
}

function stepLabel(step: LessonStepContent): string {
  switch (step.type) {
    case "choice":
      return step.prompt_en ?? step.prompt_zh ?? step.audio_en ?? "选择题";
    case "cloze":
      return step.sentence_en;
    case "order":
      return step.translation_zh;
    case "match":
      return step.instructions_zh;
    default:
      return step.type;
  }
}

/**
 * Mark the lesson completed. Every assessed step must have been attempted
 * (spec §5.3: required assessments cannot be skipped). Mastery = share of
 * objective steps answered correctly on the first try.
 */
export async function completeLesson(db: Database, userId: string, lessonId: string): Promise<LessonSummaryResult> {
  const steps = await loadSteps(db, lessonId);
  if (steps.length === 0) throw new LessonNotFoundError(`Lesson ${lessonId} not found`);

  const attempts = await db
    .select({ stepKey: lessonStepAttempts.stepKey, attemptNo: lessonStepAttempts.attemptNo, isCorrect: lessonStepAttempts.isCorrect })
    .from(lessonStepAttempts)
    .where(and(eq(lessonStepAttempts.userId, userId), eq(lessonStepAttempts.lessonId, lessonId)));

  const attempted = new Set(attempts.map((a) => a.stepKey));
  const missing = steps.filter((s) => s.assessed && !attempted.has(s.stepKey)).map((s) => s.stepKey);
  if (missing.length > 0) throw new LessonIncompleteError(missing);

  const firstTry = new Map(attempts.filter((a) => a.attemptNo === 1).map((a) => [a.stepKey, a.isCorrect]));
  const objective = steps.filter((s) => s.assessed && firstTry.get(s.stepKey) !== null && firstTry.has(s.stepKey));
  const correct = objective.filter((s) => firstTry.get(s.stepKey) === true);
  const masteryEstimate = objective.length > 0 ? correct.length / objective.length : null;

  await db
    .insert(learnerLessonProgress)
    .values({ userId, lessonId, status: "completed", completedAt: new Date(), completionRatio: 1, masteryEstimate, currentStepKey: null })
    .onConflictDoUpdate({
      target: [learnerLessonProgress.userId, learnerLessonProgress.lessonId],
      set: {
        status: "completed",
        completedAt: sql`coalesce(${learnerLessonProgress.completedAt}, now())`,
        completionRatio: 1,
        masteryEstimate,
        currentStepKey: null,
      },
    });

  const contents = steps.map((s) => s.content as LessonStepContent);
  return {
    masteryEstimate,
    objectiveCount: objective.length,
    firstTryCorrect: correct.length,
    toReview: objective
      .filter((s) => firstTry.get(s.stepKey) === false)
      .map((s) => {
        const content = s.content as LessonStepContent;
        return { stepKey: s.stepKey, skill: content.skill, label: stepLabel(content), answer: stepAnswer(content) };
      }),
    vocabularyKeys: [...new Set(contents.flatMap((c) => (c.type === "vocab" ? c.items : [])))],
    openTasksDone: contents.filter((c) => (c.type === "speak" || c.type === "write") && attempted.has(c.id)).length,
  };
}
