"use server";

import { z } from "zod";

import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";

import { addWordsFromLesson } from "../review/services/vocabulary";

import { InvalidResponseError } from "./domain/scoring";
import {
  LessonIncompleteError,
  LessonNotFoundError,
  completeLesson,
  recordStepAttempt,
  type LessonSummaryResult,
  type RecordAttemptResult,
} from "./services/progress";

const submitSchema = z.object({
  lessonId: z.string().min(1).max(120),
  stepKey: z.string().regex(/^s\d{2}$/),
  response: z.unknown(),
  clientRequestId: z.uuid(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
});

export type SubmitStepResult = { ok: true; result: RecordAttemptResult } | { ok: false; error: string };

/** Record a step (answer or "viewed"). Scored on the server; safe to retry. */
export async function submitStepAction(input: z.input<typeof submitSchema>): Promise<SubmitStepResult> {
  const user = await requireOwner();
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "提交的数据格式不正确。" };
  try {
    return { ok: true, result: await recordStepAttempt(getDb(), user.id, parsed.data) };
  } catch (error) {
    if (error instanceof InvalidResponseError) return { ok: false, error: "这个答案的格式不对，请重新作答。" };
    if (error instanceof LessonNotFoundError) return { ok: false, error: "找不到这一步，课程内容可能已更新，请刷新页面。" };
    throw error;
  }
}

export type CompleteLessonResult =
  | { ok: true; summary: LessonSummaryResult & { wordsAdded: number } }
  | { ok: false; error: string; missingStepKeys?: string[] };

/**
 * Complete the lesson, then put its words into the learner's vocabulary with
 * review cards (spec §3.5 next_review: the lesson links to spaced review).
 */
export async function completeLessonAction(lessonId: string): Promise<CompleteLessonResult> {
  const user = await requireOwner();
  if (typeof lessonId !== "string" || lessonId.length === 0 || lessonId.length > 120) {
    return { ok: false, error: "课程编号不正确。" };
  }
  try {
    const db = getDb();
    const summary = await completeLesson(db, user.id, lessonId);
    const wordsAdded = await addWordsFromLesson(db, user.id, lessonId, summary.vocabularyKeys);
    return { ok: true, summary: { ...summary, wordsAdded } };
  } catch (error) {
    if (error instanceof LessonIncompleteError) {
      return { ok: false, error: "还有需要作答的步骤没有完成。", missingStepKeys: error.missingStepKeys };
    }
    if (error instanceof LessonNotFoundError) return { ok: false, error: "找不到这节课。" };
    throw error;
  }
}
