"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { MaterialNotFoundError } from "@/modules/materials/services/materials";

import { AIError, AI_ERROR_MESSAGES } from "./provider/errors";
import {
  TutorSessionNotFoundError,
  addTutorWord,
  deleteAllTutorSessions,
  deleteTutorSession,
  getTutorSession,
  tutorReply,
  type TutorResult,
} from "./services/tutor";
import type { RoleplayScene } from "./tutor/prompts";
import { tutorRequestSchema, type TutorRequestInput } from "./tutor/request";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/** Understandable messages for every failure; never leaks provider details. */
function failure(error: unknown): { ok: false; error: string; code?: string } {
  if (error instanceof AIError) {
    if (error.code !== "not_configured" && error.code !== "budget_exceeded") console.warn(`[ai] ${error.message}`);
    return { ok: false, error: AI_ERROR_MESSAGES[error.code], code: error.code };
  }
  if (error instanceof TutorSessionNotFoundError) return { ok: false, error: "找不到这段对话，可能已经删除了。" };
  if (error instanceof MaterialNotFoundError) return { ok: false, error: "找不到这份材料。" };
  throw error;
}

/** Teaching modes: one structured reply. */
export async function tutorReplyAction(input: TutorRequestInput): Promise<Result<TutorResult>> {
  const user = await requireOwner();
  const p = tutorRequestSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "提交的内容格式不正确。" };
  try {
    return { ok: true, data: await tutorReply(getDb(), user.id, { ...p.data, scene: p.data.scene as RoleplayScene | undefined }) };
  } catch (error) {
    return failure(error);
  }
}

export async function loadTutorSessionAction(sessionId: string) {
  const user = await requireOwner();
  if (!z.uuid().safeParse(sessionId).success) return { ok: false as const, error: "找不到这段对话。" };
  try {
    return { ok: true as const, data: await getTutorSession(getDb(), user.id, sessionId) };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteTutorSessionAction(sessionId: string): Promise<Result<null>> {
  const user = await requireOwner();
  if (!z.uuid().safeParse(sessionId).success) return { ok: false, error: "找不到这段对话。" };
  try {
    await deleteTutorSession(getDb(), user.id, sessionId);
    revalidatePath("/tutor");
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteAllTutorSessionsAction(): Promise<Result<number>> {
  const user = await requireOwner();
  const n = await deleteAllTutorSessions(getDb(), user.id);
  revalidatePath("/tutor");
  revalidatePath("/settings");
  return { ok: true, data: n };
}

const wordSchema = z.object({ text: z.string().trim().min(1).max(60), zh: z.string().trim().min(1).max(200), example: z.string().max(240).nullable() });

export async function addTutorWordAction(input: z.input<typeof wordSchema>): Promise<Result<{ added: boolean }>> {
  const user = await requireOwner();
  const p = wordSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "这个词的信息不完整。" };
  const result = await addTutorWord(getDb(), user.id, p.data);
  revalidatePath("/vocabulary");
  return { ok: true, data: result };
}
