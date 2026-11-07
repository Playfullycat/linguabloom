"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { clientExercises, type ClientExercise } from "@/modules/grammar/services/grammar";
import { getLearnerSettings } from "@/modules/learner/services/profile";

import { ErrorItemNotFoundError, completeRound, getPracticeSet, resolveManually, saveErrorNote, type RoundOutcome } from "./services/errors";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const GONE = "找不到这条错误记录，请刷新页面。";
const id = z.uuid();
const mode = z.enum(["remediation", "retest"]);

async function guard<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ErrorItemNotFoundError) return { ok: false, error: GONE };
    throw error;
  }
}

function refresh() {
  revalidatePath("/errors");
  revalidatePath("/today");
}

export async function saveErrorNoteAction(input: { id: string; note: string }): Promise<Result<null>> {
  const user = await requireOwner();
  const p = z.object({ id, note: z.string().max(2000) }).safeParse(input);
  if (!p.success) return { ok: false, error: "备注最多 2000 个字。" };
  return guard(async () => {
    await saveErrorNote(getDb(), user.id, p.data.id, p.data.note);
    return null;
  });
}

export async function resolveErrorAction(itemId: string): Promise<Result<null>> {
  const user = await requireOwner();
  if (!id.safeParse(itemId).success) return { ok: false, error: GONE };
  const result = await guard(async () => {
    await resolveManually(getDb(), user.id, itemId);
    return null;
  });
  if (result.ok) refresh();
  return result;
}

/** The exercises for a remediation round or a retest (prompts only). */
export async function startPracticeAction(input: { itemId: string; mode: "remediation" | "retest" }): Promise<Result<ClientExercise[]>> {
  const user = await requireOwner();
  const p = z.object({ itemId: id, mode }).safeParse(input);
  if (!p.success) return { ok: false, error: GONE };
  return guard(async () => {
    const db = getDb();
    return clientExercises(db, await getPracticeSet(db, user.id, p.data.itemId, p.data.mode));
  });
}

export async function completeRoundAction(input: { itemId: string; mode: "remediation" | "retest"; exerciseIds: string[] }): Promise<Result<RoundOutcome>> {
  const user = await requireOwner();
  const p = z.object({ itemId: id, mode, exerciseIds: z.array(z.string().min(1).max(120)).min(1).max(5) }).safeParse(input);
  if (!p.success) return { ok: false, error: "提交的数据格式不正确。" };
  const db = getDb();
  const { profile } = await getLearnerSettings(db, user.id);
  const result = await guard(() => completeRound(db, user.id, { ...p.data, timeZone: profile.timezone }));
  if (result.ok) refresh();
  return result;
}
