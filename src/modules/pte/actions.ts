"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { AI_ERROR_MESSAGES, type AIErrorCode } from "@/modules/ai/provider/errors";

import { PteNotFoundError, PteRejectedError, submitAttempt, type SubmitResult } from "./services/pte";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const responseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("choices"), choices: z.array(z.number().int().min(0).max(10).nullable()).max(10) }),
  z.object({ kind: z.literal("selected"), selected: z.array(z.number().int().min(0).max(500)).max(500) }),
  z.object({ kind: z.literal("order"), order: z.array(z.string().regex(/^[A-J]$/)).max(10) }),
  z.object({ kind: z.literal("words"), words: z.array(z.string().max(60).nullable()).max(10) }),
  z.object({ kind: z.literal("choice"), choice: z.number().int().min(0).max(10).nullable() }),
  z.object({ kind: z.literal("text"), text: z.string().max(2000) }),
]);

const submitSchema = z.object({
  promptId: z.string().regex(/^pte-[a-z0-9-]+$/),
  response: responseSchema,
  mode: z.enum(["practice", "timed"]),
  durationMs: z.number().min(0).max(3_600_000),
  timedOut: z.boolean(),
  clientRequestId: z.uuid(),
});

export async function submitPteAttemptAction(input: z.input<typeof submitSchema>): Promise<Result<SubmitResult & { feedbackMessage: string | null }>> {
  const user = await requireOwner();
  const p = submitSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "提交的答案格式不正确。" };
  try {
    const r = await submitAttempt(getDb(), user.id, p.data);
    revalidatePath("/pte", "layout");
    revalidatePath("/errors");
    return { ok: true, data: { ...r, feedbackMessage: r.feedbackError ? (AI_ERROR_MESSAGES[r.feedbackError as AIErrorCode] ?? AI_ERROR_MESSAGES.unknown) : null } };
  } catch (error) {
    if (error instanceof PteRejectedError) return { ok: false, error: error.message };
    if (error instanceof PteNotFoundError) return { ok: false, error: "找不到这道题。" };
    throw error;
  }
}
