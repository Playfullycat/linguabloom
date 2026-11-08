"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { AI_ERROR_MESSAGES, type AIErrorCode } from "@/modules/ai/provider/errors";

import { SECTIONS } from "./content";
import { finishMock, saveMockProgress, startOrResumeMock, type MockState } from "./services/mock";
import { PteNotFoundError, PteRejectedError, submitAttempt, type SubmitResult } from "./services/pte";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export type SubmitData = SubmitResult & { feedbackMessage: string | null; mock: MockState | null };

const responseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("choices"), choices: z.array(z.number().int().min(0).max(10).nullable()).max(10) }),
  z.object({ kind: z.literal("selected"), selected: z.array(z.number().int().min(0).max(500)).max(500) }),
  z.object({ kind: z.literal("order"), order: z.array(z.string().regex(/^[A-J]$/)).max(10) }),
  z.object({ kind: z.literal("words"), words: z.array(z.string().max(60).nullable()).max(10) }),
  z.object({ kind: z.literal("choice"), choice: z.number().int().min(0).max(10).nullable() }),
  z.object({ kind: z.literal("text"), text: z.string().max(4000) }),
  // Typed instead of spoken (no microphone / no transcription); recordings go through /api/pte/attempt.
  z.object({ kind: z.literal("spoken"), transcript: z.string().max(4000), seconds: z.number().min(0).max(600), typed: z.boolean() }),
]);

const submitSchema = z.object({
  promptId: z.string().regex(/^pte-[a-z0-9-]+$/),
  response: responseSchema,
  mode: z.enum(["practice", "timed", "mock"]),
  durationMs: z.number().min(0).max(3_600_000),
  timedOut: z.boolean(),
  clientRequestId: z.uuid(),
  mockTestId: z.uuid().optional(),
  /** Mock tests: section time used so far. */
  elapsedSeconds: z.number().min(0).max(36_000).optional(),
});

export async function submitPteAttemptAction(input: z.input<typeof submitSchema>): Promise<Result<SubmitData>> {
  const user = await requireOwner();
  const p = submitSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "提交的答案格式不正确。" };
  if (p.data.mode === "mock" && !p.data.mockTestId) return { ok: false, error: "提交的答案格式不正确。" };
  const db = getDb();
  try {
    // Through this action a spoken answer can only be typed (recordings go through /api/pte/attempt).
    const response = p.data.response.kind === "spoken" ? { ...p.data.response, typed: true } : p.data.response;
    const r = await submitAttempt(db, user.id, { ...p.data, response });
    const mock = p.data.mockTestId ? await saveMockProgress(db, user.id, p.data.mockTestId, p.data.elapsedSeconds ?? 0) : null;
    revalidatePath("/pte", "layout");
    revalidatePath("/errors");
    revalidatePath("/today");
    return { ok: true, data: { ...r, feedbackMessage: r.feedbackError ? (AI_ERROR_MESSAGES[r.feedbackError as AIErrorCode] ?? AI_ERROR_MESSAGES.unknown) : null, mock } };
  } catch (error) {
    if (error instanceof PteRejectedError) return { ok: false, error: error.message };
    if (error instanceof PteNotFoundError) return { ok: false, error: "找不到这道题。" };
    throw error;
  }
}

export async function startMockAction(section: string): Promise<Result<{ id: string }>> {
  const user = await requireOwner();
  const s = z.enum(SECTIONS).safeParse(section);
  if (!s.success) return { ok: false, error: "没有这个部分。" };
  try {
    return { ok: true, data: { id: await startOrResumeMock(getDb(), user.id, s.data) } };
  } catch (error) {
    if (error instanceof PteRejectedError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Save the time used (on pause / leaving); reaching the limit ends the test. */
export async function saveMockProgressAction(id: string, elapsedSeconds: number): Promise<Result<MockState>> {
  const user = await requireOwner();
  if (!z.uuid().safeParse(id).success || !Number.isFinite(elapsedSeconds)) return { ok: false, error: "找不到这次模拟练习。" };
  try {
    const state = await saveMockProgress(getDb(), user.id, id, elapsedSeconds);
    revalidatePath("/pte", "layout");
    return { ok: true, data: state };
  } catch (error) {
    if (error instanceof PteNotFoundError) return { ok: false, error: "找不到这次模拟练习。" };
    throw error;
  }
}

export async function finishMockAction(id: string): Promise<Result<MockState>> {
  const user = await requireOwner();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "找不到这次模拟练习。" };
  try {
    const state = await finishMock(getDb(), user.id, id, "finished");
    revalidatePath("/pte", "layout");
    return { ok: true, data: state };
  } catch (error) {
    if (error instanceof PteNotFoundError) return { ok: false, error: "找不到这次模拟练习。" };
    throw error;
  }
}
