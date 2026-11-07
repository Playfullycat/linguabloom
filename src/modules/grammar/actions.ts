"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";

import { InvalidExerciseResponseError } from "./domain/scoring";
import { GrammarNotFoundError, answerExercise, type ExerciseResult } from "./services/grammar";

export type AnswerExerciseResult = { ok: true; result: ExerciseResult } | { ok: false; error: string };

const schema = z.object({
  exerciseId: z.string().min(1).max(120),
  response: z.unknown(),
  clientRequestId: z.uuid(),
  context: z.enum(["practice", "remediation", "retest"]),
  errorItemId: z.uuid().optional(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
});

/** Score one exercise on the server. Safe to retry with the same request id. */
export async function answerExerciseAction(input: z.input<typeof schema>): Promise<AnswerExerciseResult> {
  const user = await requireOwner();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "提交的数据格式不正确。" };
  try {
    const result = await answerExercise(getDb(), user.id, parsed.data);
    if (result.errorRecorded) revalidatePath("/errors");
    return { ok: true, result };
  } catch (error) {
    if (error instanceof InvalidExerciseResponseError) return { ok: false, error: "这个答案的格式不对，请重新作答。" };
    if (error instanceof GrammarNotFoundError) return { ok: false, error: "这道题已经下架了，请刷新页面。" };
    throw error;
  }
}
