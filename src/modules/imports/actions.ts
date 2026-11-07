"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { CEFR_LEVELS } from "@/modules/curriculum/domain/cefr";

import { ImportNotFoundError, ImportRejectedError, deleteImportedMaterial, discardImport, publishImport } from "./services/imports";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function guard<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ImportNotFoundError) return { ok: false, error: "找不到这条导入记录，请刷新页面。" };
    if (error instanceof ImportRejectedError) return { ok: false, error: "这条导入已经处理过了，或者没有可以导入的内容。" };
    throw error;
  }
}

function refresh() {
  for (const p of ["/library", "/reading", "/listening", "/vocabulary", "/review", "/today"]) revalidatePath(p);
}

const publishSchema = z.object({ id: z.uuid(), level: z.enum(CEFR_LEVELS), title: z.string().max(120).optional() });

/** Confirm the preview: the material (or word list) goes into the learning library. */
export async function publishImportAction(input: z.input<typeof publishSchema>) {
  const user = await requireOwner();
  const p = publishSchema.safeParse(input);
  if (!p.success) return { ok: false as const, error: "请选择一个等级。" };
  const result = await guard(() => publishImport(getDb(), user.id, p.data.id, { level: p.data.level, title: p.data.title }));
  if (result.ok) refresh();
  return result;
}

export async function discardImportAction(id: string): Promise<Result<null>> {
  const user = await requireOwner();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "找不到这条导入记录。" };
  const result = await guard(async () => {
    await discardImport(getDb(), user.id, id);
    return null;
  });
  if (result.ok) refresh();
  return result;
}

/** Delete an imported material with its audio and the learner's records on it. */
export async function deleteImportedMaterialAction(importId: string): Promise<Result<null>> {
  const user = await requireOwner();
  if (!z.uuid().safeParse(importId).success) return { ok: false, error: "找不到这条导入记录。" };
  const result = await guard(async () => {
    await deleteImportedMaterial(getDb(), user.id, importId);
    return null;
  });
  if (result.ok) refresh();
  return result;
}
