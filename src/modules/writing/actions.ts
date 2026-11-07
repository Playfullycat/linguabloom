"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { AIError, AI_ERROR_MESSAGES } from "@/modules/ai/provider/errors";

import { MAX_WRITING_CHARS, WritingNotFoundError, WritingRejectedError, createWritingDraft, deleteWriting, requestFeedback, reviseWriting } from "./services/writing";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof AIError) return { ok: false, error: AI_ERROR_MESSAGES[error.code] };
  if (error instanceof WritingNotFoundError) return { ok: false, error: "找不到这篇写作。" };
  if (error instanceof WritingRejectedError) return { ok: false, error: "至少写 5 个英文单词，最多 4000 个字符。" };
  throw error;
}

const submitSchema = z.object({
  promptId: z.string().max(80).nullable(),
  custom: z.object({ title: z.string().max(80), task: z.string().max(500) }).optional(),
  text: z.string().max(MAX_WRITING_CHARS, "最多 4000 个字符"),
});

/**
 * Save the text, then ask for feedback. The id comes back even when the AI
 * fails, so the learner never loses what they wrote and can retry.
 */
export async function submitWritingAction(input: z.input<typeof submitSchema>): Promise<Result<{ id: string; feedbackError: string | null }>> {
  const user = await requireOwner();
  const p = submitSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "提交的内容格式不正确。" };
  const db = getDb();
  let id: string;
  try {
    id = await createWritingDraft(db, user.id, p.data);
  } catch (error) {
    return failure(error);
  }
  let feedbackError: string | null = null;
  try {
    await requestFeedback(db, user.id, id);
  } catch (error) {
    const f = failure(error);
    feedbackError = f.error;
  }
  revalidatePath("/writing");
  revalidatePath("/errors");
  return { ok: true, data: { id, feedbackError } };
}

export async function retryFeedbackAction(id: string): Promise<Result<null>> {
  const user = await requireOwner();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "找不到这篇写作。" };
  try {
    await requestFeedback(getDb(), user.id, id);
    revalidatePath(`/writing/${id}`);
    revalidatePath("/errors");
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}

export async function reviseWritingAction(input: { id: string; text: string }): Promise<Result<null>> {
  const user = await requireOwner();
  const p = z.object({ id: z.uuid(), text: z.string().max(MAX_WRITING_CHARS) }).safeParse(input);
  if (!p.success) return { ok: false, error: "最多 4000 个字符。" };
  try {
    await reviseWriting(getDb(), user.id, p.data.id, p.data.text);
    revalidatePath(`/writing/${p.data.id}`);
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteWritingAction(id: string): Promise<Result<null>> {
  const user = await requireOwner();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "找不到这篇写作。" };
  try {
    await deleteWriting(getDb(), user.id, id);
    revalidatePath("/writing");
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}
