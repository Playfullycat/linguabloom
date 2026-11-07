"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { CARD_TYPES } from "@/db/schema";
import { requireOwner } from "@/lib/auth/session";

import { answerCard, getClientCard, type AnswerResult, type ClientReviewCard } from "./services/review";
import { CardNotFoundError, EntryNotFoundError, addCardType, setCardSuspended } from "./services/vocabulary";

const answerSchema = z.object({
  cardId: z.uuid(),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  clientRequestId: z.uuid(),
  elapsedMs: z.number().int().min(0).max(3_600_000).optional(),
  typed: z.string().max(200).optional(),
  overridden: z.boolean().optional(),
  hintUsed: z.boolean().optional(),
});

export type AnswerActionResult = { ok: true; result: AnswerResult } | { ok: false; error: string };

/** Record one review. The server re-checks typed answers and enforces the rating rules. */
export async function answerReviewAction(input: z.input<typeof answerSchema>): Promise<AnswerActionResult> {
  const user = await requireOwner();
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "提交的数据格式不正确。" };
  try {
    return { ok: true, result: await answerCard(getDb(), user.id, parsed.data) };
  } catch (error) {
    if (error instanceof CardNotFoundError) return { ok: false, error: "这张卡片不存在了，请刷新页面。" };
    throw error;
  }
}

/** Fetch a card again to re-show it later in the same session (learning steps). */
export async function getReviewCardAction(cardId: string): Promise<ClientReviewCard | null> {
  const user = await requireOwner();
  if (!z.uuid().safeParse(cardId).success) return null;
  return getClientCard(getDb(), user.id, cardId);
}

export async function addCardTypeAction(entryId: string, cardType: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireOwner();
  const type = z.enum(CARD_TYPES).safeParse(cardType);
  if (!type.success || typeof entryId !== "string" || entryId.length > 200) return { ok: false, error: "参数不正确。" };
  try {
    await addCardType(getDb(), user.id, entryId, type.data);
  } catch (error) {
    if (error instanceof EntryNotFoundError) return { ok: false, error: "这个词不能添加这种卡片。" };
    throw error;
  }
  revalidatePath(`/vocabulary/${entryId}`);
  return { ok: true };
}

export async function setCardSuspendedAction(cardId: string, suspended: boolean, entryId: string): Promise<{ ok: boolean }> {
  const user = await requireOwner();
  if (!z.uuid().safeParse(cardId).success) return { ok: false };
  try {
    await setCardSuspended(getDb(), user.id, cardId, Boolean(suspended));
  } catch (error) {
    if (error instanceof CardNotFoundError) return { ok: false };
    throw error;
  }
  revalidatePath(`/vocabulary/${entryId}`);
  return { ok: true };
}
