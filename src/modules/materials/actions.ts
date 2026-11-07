"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";

import {
  MaterialNotFoundError,
  SIMPLE_EVENTS,
  answerQuestion,
  checkDictationAttempt,
  collectWord,
  lookupWord,
  markCompleted,
  recordEvent,
  saveNote,
  setFavorite,
  toggleSavedSegment,
  type DictationResult,
  type LookupResult,
  type QuestionResult,
} from "./services/materials";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const GONE = "找不到这份材料，可能已经下架，请刷新页面。";
const BAD = "提交的数据格式不正确。";
const contentId = z.string().min(1).max(120);

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof MaterialNotFoundError) return { ok: false, error: GONE };
    throw error;
  }
}

const lookupSchema = z.object({
  contentId,
  word: z.string().min(1).max(80),
  glossKey: z.string().max(80).nullable(),
  segmentSeq: z.number().int().min(0).max(1000).nullable(),
});

export async function lookupWordAction(input: z.input<typeof lookupSchema>): Promise<Result<LookupResult>> {
  const user = await requireOwner();
  const p = lookupSchema.safeParse(input);
  if (!p.success) return { ok: false, error: BAD };
  return run(() => lookupWord(getDb(), user.id, p.data.contentId, p.data.word, p.data.glossKey, p.data.segmentSeq));
}

const collectSchema = z.object({ contentId, entryId: z.string().min(1).max(200) });

export async function collectWordAction(input: z.input<typeof collectSchema>): Promise<Result<{ added: boolean }>> {
  const user = await requireOwner();
  const p = collectSchema.safeParse(input);
  if (!p.success) return { ok: false, error: BAD };
  const result = await run(() => collectWord(getDb(), user.id, p.data.contentId, p.data.entryId));
  if (result.ok) revalidatePath("/vocabulary");
  return result;
}

const questionSchema = z.object({
  contentId,
  questionId: z.string().regex(/^q\d+$/),
  choice: z.number().int().min(0).max(10),
  clientRequestId: z.uuid(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
});

export async function answerQuestionAction(input: z.input<typeof questionSchema>): Promise<Result<QuestionResult>> {
  const user = await requireOwner();
  const p = questionSchema.safeParse(input);
  if (!p.success) return { ok: false, error: BAD };
  return run(() => answerQuestion(getDb(), user.id, p.data));
}

const dictationSchema = z.object({
  contentId,
  segmentSeq: z.number().int().min(0).max(1000),
  mode: z.enum(["sentence", "keyword"]),
  text: z.string().max(500),
  clientRequestId: z.uuid(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
});

export async function checkDictationAction(input: z.input<typeof dictationSchema>): Promise<Result<DictationResult>> {
  const user = await requireOwner();
  const p = dictationSchema.safeParse(input);
  if (!p.success) return { ok: false, error: BAD };
  return run(() => checkDictationAttempt(getDb(), user.id, p.data));
}

const eventSchema = z.object({
  contentId,
  kind: z.enum(SIMPLE_EVENTS),
  segmentSeq: z.number().int().min(0).max(1000).optional(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
  detail: z.string().max(40).optional(),
});

/** Fire-and-forget study events (never blocks the reader). */
export async function recordEventAction(input: z.input<typeof eventSchema>): Promise<Result<null>> {
  const user = await requireOwner();
  const p = eventSchema.safeParse(input);
  if (!p.success) return { ok: false, error: BAD };
  return run(async () => {
    await recordEvent(getDb(), user.id, p.data);
    return null;
  });
}

const stateSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("favorite"), contentId, favorite: z.boolean() }),
  z.object({ op: z.literal("note"), contentId, note: z.string().max(4000) }),
  z.object({ op: z.literal("saveSegment"), contentId, segmentSeq: z.number().int().min(0).max(1000) }),
  z.object({ op: z.literal("complete"), contentId }),
]);

/** Favourite, note, saved sentences, finished. */
export async function updateMaterialStateAction(input: z.input<typeof stateSchema>): Promise<Result<{ savedSegments?: number[] }>> {
  const user = await requireOwner();
  const p = stateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: BAD };
  const db = getDb();
  const d = p.data;
  const result = await run(async () => {
    switch (d.op) {
      case "favorite":
        await setFavorite(db, user.id, d.contentId, d.favorite);
        return {};
      case "note":
        await saveNote(db, user.id, d.contentId, d.note);
        return {};
      case "saveSegment":
        return { savedSegments: await toggleSavedSegment(db, user.id, d.contentId, d.segmentSeq) };
      case "complete":
        await markCompleted(db, user.id, d.contentId);
        return {};
    }
  });
  if (result.ok && (d.op === "complete" || d.op === "favorite")) {
    revalidatePath("/reading");
    revalidatePath("/listening");
    revalidatePath("/today");
  }
  return result;
}
