"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";

import { FLUENCY_KINDS } from "./domain/fluency";
import { FluencyInputError, MaterialNotFoundError, submitFluencyAttempt, type FluencyResult } from "./services/fluency";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const submitSchema = z.object({
  kind: z.enum(FLUENCY_KINDS),
  contentId: z.string().min(1).max(120),
  clientRequestId: z.uuid(),
  rounds: z
    .array(z.object({ ms: z.number().int().min(0).max(3_600_000), rating: z.enum(["smooth", "ok", "stuck"]).optional() }))
    .min(1)
    .max(3),
  answers: z.array(z.object({ questionId: z.string().regex(/^q\d+$/), choice: z.number().int().min(0).max(10) })).max(10).optional(),
  durationMs: z.number().min(0).max(24 * 3_600_000),
});

export async function submitFluencyAction(input: z.input<typeof submitSchema>): Promise<Result<FluencyResult>> {
  const user = await requireOwner();
  const p = submitSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "提交的数据格式不正确。" };
  try {
    const data = await submitFluencyAttempt(getDb(), user.id, p.data);
    revalidatePath("/fluency");
    revalidatePath("/today");
    return { ok: true, data };
  } catch (error) {
    if (error instanceof MaterialNotFoundError) return { ok: false, error: "找不到这篇材料，可能已经下架，请刷新页面。" };
    if (error instanceof FluencyInputError) return { ok: false, error: error.message };
    throw error;
  }
}
