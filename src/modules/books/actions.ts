"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";

import { BOOK_STATUSES, BookNotFoundError, MAX_LOG_MINUTES, logReading, setBookStatus } from "./services/books";

export type Result = { ok: true } | { ok: false; error: string };

const bookId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const GONE = "找不到这本书，可能已经从书单里移除，请刷新页面。";

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof BookNotFoundError) return { ok: false, error: GONE };
    throw error;
  }
  revalidatePath("/reading/books");
  return { ok: true };
}

const statusSchema = z.object({ bookId, status: z.enum(BOOK_STATUSES).nullable() });

export async function setBookStatusAction(input: z.input<typeof statusSchema>): Promise<Result> {
  const user = await requireOwner();
  const p = statusSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "提交的数据格式不正确。" };
  return run(() => setBookStatus(getDb(), user.id, p.data.bookId, p.data.status));
}

const logSchema = z.object({
  bookId,
  minutes: z.number().int().min(1, "至少 1 分钟。").max(MAX_LOG_MINUTES, `一次最多记 ${MAX_LOG_MINUTES} 分钟。`),
  pages: z.number().int().min(1).max(2000).nullable().optional(),
  clientRequestId: z.uuid(),
});

export async function logReadingAction(input: z.input<typeof logSchema>): Promise<Result> {
  const user = await requireOwner();
  const p = logSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "提交的数据格式不正确。" };
  const result = await run(() => logReading(getDb(), user.id, p.data));
  if (result.ok) {
    revalidatePath("/today");
    revalidatePath("/progress");
  }
  return result;
}
