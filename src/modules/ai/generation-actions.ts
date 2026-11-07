"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { CEFR_LEVELS } from "@/modules/curriculum/domain/cefr";
import { MaterialNotFoundError } from "@/modules/materials/services/materials";

import { AIError, AI_ERROR_MESSAGES } from "./provider/errors";
import {
  GenerationNotFoundError,
  GenerationRejectedError,
  collectAiWord,
  discardGeneration,
  explainWord,
  generateEnrichment,
  generateGradedReading,
  generateMicroLesson,
  publishGeneration,
  type AiDefinition,
} from "./services/generation";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function guard<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof AIError) return { ok: false, error: AI_ERROR_MESSAGES[error.code] };
    if (error instanceof GenerationNotFoundError || error instanceof MaterialNotFoundError) return { ok: false, error: "找不到要处理的内容，请刷新页面。" };
    if (error instanceof GenerationRejectedError) return { ok: false, error: "这份内容已经处理过了，或者请求不完整。" };
    throw error;
  }
}

const refreshAll = () => {
  for (const p of ["/library", "/reading", "/listening", "/vocabulary", "/errors"]) revalidatePath(p);
};

export async function explainWordAction(input: { word: string; sentence: string }): Promise<Result<AiDefinition>> {
  const user = await requireOwner();
  const p = z.object({ word: z.string().trim().min(1).max(60), sentence: z.string().max(400) }).safeParse(input);
  if (!p.success) return { ok: false, error: "请求不完整。" };
  return guard(() => explainWord(getDb(), user.id, p.data));
}

const defSchema = z.object({
  text: z.string().min(1).max(60),
  pos: z.string().max(30).nullable(),
  ipa: z.string().max(60).nullable(),
  zh: z.string().min(1).max(200),
  explanation_zh: z.string().max(400).nullable(),
  example_en: z.string().max(240).nullable(),
  example_zh: z.string().max(240).nullable(),
});

export async function collectAiWordAction(input: z.input<typeof defSchema>): Promise<Result<{ added: boolean }>> {
  const user = await requireOwner();
  const p = defSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "这个词的信息不完整。" };
  const r = await guard(() => collectAiWord(getDb(), user.id, p.data));
  if (r.ok) revalidatePath("/vocabulary");
  return r;
}

export async function generateEnrichmentAction(contentId: string): Promise<Result<string>> {
  const user = await requireOwner();
  if (!z.string().min(1).max(120).safeParse(contentId).success) return { ok: false, error: "请求不完整。" };
  return guard(() => generateEnrichment(getDb(), user.id, contentId));
}

const gradedSchema = z.object({ topic: z.string().trim().min(1, "请写一个话题").max(80), level: z.enum(CEFR_LEVELS), type: z.enum(["reading", "listening"]) });

export async function generateGradedReadingAction(input: z.input<typeof gradedSchema>): Promise<Result<string>> {
  const user = await requireOwner();
  const p = gradedSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "请求不完整。" };
  const r = await guard(() => generateGradedReading(getDb(), user.id, p.data));
  if (r.ok) revalidatePath("/library");
  return r;
}

export async function generateMicroLessonAction(errorItemId: string): Promise<Result<string>> {
  const user = await requireOwner();
  if (!z.uuid().safeParse(errorItemId).success) return { ok: false, error: "请求不完整。" };
  const r = await guard(() => generateMicroLesson(getDb(), user.id, errorItemId));
  if (r.ok) revalidatePath(`/errors/${errorItemId}`);
  return r;
}

export async function publishGenerationAction(id: string) {
  const user = await requireOwner();
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: "请求不完整。" };
  const r = await guard(() => publishGeneration(getDb(), user.id, id));
  if (r.ok) refreshAll();
  return r;
}

export async function discardGenerationAction(id: string): Promise<Result<null>> {
  const user = await requireOwner();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "请求不完整。" };
  const r = await guard(async () => {
    await discardGeneration(getDb(), user.id, id);
    return null;
  });
  if (r.ok) refreshAll();
  return r;
}
