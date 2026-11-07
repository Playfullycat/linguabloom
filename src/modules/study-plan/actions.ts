"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { updatePreferences } from "@/modules/learner/services/profile";

import { isSessionLength } from "./domain/session-templates";
import { PlanTaskNotFoundError, SKIP_REASONS, moveTask, regenerateTodayPlan, restoreTask, skipTask } from "./services/plan";

export type PlanActionResult = { ok: true } | { ok: false; error: string };

const TASK_GONE = "这个任务已经不在今天的计划里了，请刷新页面。";

const regenerateSchema = z.object({
  sessionMinutes: z.number().int().refine(isSessionLength).optional(),
  mode: z.enum(["normal", "review_only"]).optional(),
});

/** Change today's length or mode (or just refresh the plan with the latest facts). */
export async function regeneratePlanAction(input: z.input<typeof regenerateSchema>): Promise<PlanActionResult> {
  const user = await requireOwner();
  const parsed = regenerateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "提交的数据格式不正确。" };
  const { sessionMinutes, mode } = parsed.data;
  await regenerateTodayPlan(getDb(), user.id, { sessionMinutes: sessionMinutes as never, mode });
  revalidatePath("/today");
  return { ok: true };
}

const moveSchema = z.object({ taskId: z.uuid(), direction: z.enum(["up", "down"]) });

export async function moveTaskAction(input: z.input<typeof moveSchema>): Promise<PlanActionResult> {
  const user = await requireOwner();
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "提交的数据格式不正确。" };
  try {
    await moveTask(getDb(), user.id, parsed.data.taskId, parsed.data.direction);
  } catch (error) {
    if (error instanceof PlanTaskNotFoundError) return { ok: false, error: TASK_GONE };
    throw error;
  }
  revalidatePath("/today");
  return { ok: true };
}

const skipSchema = z.object({ taskId: z.uuid(), reason: z.enum(SKIP_REASONS) });

export async function skipTaskAction(input: z.input<typeof skipSchema>): Promise<PlanActionResult> {
  const user = await requireOwner();
  const parsed = skipSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "请选择一个跳过的原因。" };
  try {
    await skipTask(getDb(), user.id, parsed.data.taskId, parsed.data.reason);
  } catch (error) {
    if (error instanceof PlanTaskNotFoundError) return { ok: false, error: TASK_GONE };
    throw error;
  }
  revalidatePath("/today");
  return { ok: true };
}

export async function restoreTaskAction(taskId: string): Promise<PlanActionResult> {
  const user = await requireOwner();
  if (!z.uuid().safeParse(taskId).success) return { ok: false, error: "提交的数据格式不正确。" };
  try {
    await restoreTask(getDb(), user.id, taskId);
  } catch (error) {
    if (error instanceof PlanTaskNotFoundError) return { ok: false, error: TASK_GONE };
    throw error;
  }
  revalidatePath("/today");
  return { ok: true };
}

/** Hide the gentle "days this week" note (can be turned back on in Settings). */
export async function hideWeeklyNoteAction(): Promise<PlanActionResult> {
  const user = await requireOwner();
  await updatePreferences(getDb(), user.id, { showWeeklyStreak: false });
  revalidatePath("/today");
  return { ok: true };
}
