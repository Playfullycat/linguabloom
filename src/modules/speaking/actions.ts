"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { AIError, AI_ERROR_MESSAGES } from "@/modules/ai/provider/errors";

import {
  MAX_TURN_TEXT,
  SpeakingNotFoundError,
  SpeakingRejectedError,
  deleteAllSpeaking,
  deleteSpeakingAttempt,
  deleteSpeakingAudio,
  endSpeaking,
  requestSpeakingFeedback,
  startSpeaking,
} from "./services/speaking";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof AIError) return { ok: false, error: AI_ERROR_MESSAGES[error.code] };
  if (error instanceof SpeakingRejectedError) return { ok: false, error: error.message };
  if (error instanceof SpeakingNotFoundError) return { ok: false, error: "找不到这次口语练习。" };
  throw error;
}

const startSchema = z.object({
  taskId: z.string().max(80),
  mode: z.enum(["realtime", "standard", "typed"]),
  saveTranscript: z.boolean(),
  saveAudio: z.boolean(),
});

export async function startSpeakingAction(input: z.input<typeof startSchema>) {
  const user = await requireOwner();
  const p = startSchema.safeParse(input);
  if (!p.success) return { ok: false as const, error: "提交的内容格式不正确。" };
  try {
    return { ok: true as const, data: await startSpeaking(getDb(), user.id, p.data) };
  } catch (error) {
    return failure(error);
  }
}

const turnsSchema = z
  .array(z.object({ role: z.enum(["learner", "ai"]), text: z.string().max(MAX_TURN_TEXT * 2), item: z.number().int().min(0).max(20).optional(), interrupted: z.boolean().optional() }))
  .max(80);

const endSchema = z.object({
  id: z.uuid(),
  reason: z.enum(["completed", "user", "disconnected", "time_limit", "error"]),
  durationSeconds: z.number().min(0).max(7200),
  turns: turnsSchema.optional(),
});

/**
 * End the session, then ask for feedback. Ending always succeeds on its
 * own; a feedback failure is reported separately and can be retried.
 */
export async function endSpeakingAction(input: z.input<typeof endSchema>): Promise<Result<{ feedbackError: string | null }>> {
  const user = await requireOwner();
  const p = endSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "提交的内容格式不正确。" };
  const db = getDb();
  try {
    await endSpeaking(db, user.id, p.data.id, p.data);
  } catch (error) {
    return failure(error);
  }
  let feedbackError: string | null = null;
  try {
    await requestSpeakingFeedback(db, user.id, p.data.id, p.data.turns);
  } catch (error) {
    feedbackError = failure(error).error;
  }
  revalidatePath("/speaking", "layout");
  revalidatePath("/errors");
  return { ok: true, data: { feedbackError } };
}

/**
 * Close a session without feedback and without refreshing the page: used when
 * a dropped realtime session hands over to the standard mode on the same page
 * (a refresh would reset it). Feedback can still be requested later.
 */
export async function closeSpeakingAction(input: z.input<typeof endSchema>): Promise<Result<null>> {
  const user = await requireOwner();
  const p = endSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "提交的内容格式不正确。" };
  try {
    await endSpeaking(getDb(), user.id, p.data.id, p.data);
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}

export async function retrySpeakingFeedbackAction(id: string): Promise<Result<null>> {
  const user = await requireOwner();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "找不到这次口语练习。" };
  try {
    await requestSpeakingFeedback(getDb(), user.id, id);
    revalidatePath(`/speaking/attempts/${id}`);
    revalidatePath("/errors");
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteSpeakingAudioAction(id: string): Promise<Result<{ removed: number }>> {
  const user = await requireOwner();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "找不到这次口语练习。" };
  try {
    const removed = await deleteSpeakingAudio(getDb(), user.id, id);
    revalidatePath(`/speaking/attempts/${id}`);
    revalidatePath("/speaking", "layout");
    return { ok: true, data: { removed } };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteSpeakingAttemptAction(id: string): Promise<Result<null>> {
  const user = await requireOwner();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "找不到这次口语练习。" };
  try {
    await deleteSpeakingAttempt(getDb(), user.id, id);
    revalidatePath("/speaking", "layout");
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteAllSpeakingAction(): Promise<Result<{ sessions: number; recordings: number }>> {
  const user = await requireOwner();
  const data = await deleteAllSpeaking(getDb(), user.id);
  revalidatePath("/speaking", "layout");
  revalidatePath("/settings");
  return { ok: true, data };
}
