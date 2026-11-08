import { and, desc, eq } from "drizzle-orm";

import type { Database } from "@/db/connection";
import { reviewCards, reviewLogs } from "@/db/schema";

import type { Grade } from "../domain/cards";
import { answerCard } from "./review";
import { CardNotFoundError } from "./vocabulary";

/**
 * Answers given while offline (Phase 5.3), applied in the order they were
 * given and at the time they were given, so FSRS schedules them as if they
 * had been sent straight away. Each answer is idempotent by its request id.
 *
 * An answer is skipped (not an error) when:
 * - the card has a newer review already (e.g. reviewed online meanwhile):
 *   applying an older answer on top would make the log unreplayable;
 * - it is older than OFFLINE_MAX_AGE_DAYS;
 * - the card no longer exists.
 */

export const OFFLINE_MAX_AGE_DAYS = 14;
/** Clock drift allowed for a device's timestamp. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

export type OfflineAnswer = {
  cardId: string;
  rating: Grade;
  clientRequestId: string;
  reviewedAt: string;
  elapsedMs?: number;
  typed?: string;
};

export type OfflineResult = { clientRequestId: string; status: "stored" | "duplicate" | "stale" | "missing" | "too_old" };

export async function applyOfflineAnswers(db: Database, userId: string, answers: OfflineAnswer[], now = new Date()): Promise<OfflineResult[]> {
  const results: OfflineResult[] = [];
  const ordered = [...answers].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
  for (const answer of ordered) {
    let at = new Date(answer.reviewedAt);
    if (Number.isNaN(at.getTime()) || now.getTime() - at.getTime() > OFFLINE_MAX_AGE_DAYS * 86_400_000) {
      results.push({ clientRequestId: answer.clientRequestId, status: "too_old" });
      continue;
    }
    if (at.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) at = now;

    // A repeat of an answer already stored is reported as such (answerCard is idempotent too).
    const [already] = await db.select({ id: reviewLogs.id }).from(reviewLogs).where(and(eq(reviewLogs.userId, userId), eq(reviewLogs.clientRequestId, answer.clientRequestId))).limit(1);
    if (already) {
      results.push({ clientRequestId: answer.clientRequestId, status: "duplicate" });
      continue;
    }

    const [card] = await db.select({ id: reviewCards.id }).from(reviewCards).where(and(eq(reviewCards.id, answer.cardId), eq(reviewCards.userId, userId))).limit(1);
    if (!card) {
      results.push({ clientRequestId: answer.clientRequestId, status: "missing" });
      continue;
    }
    const [latest] = await db.select({ at: reviewLogs.reviewedAt }).from(reviewLogs).where(eq(reviewLogs.cardId, card.id)).orderBy(desc(reviewLogs.reviewedAt)).limit(1);
    if (latest && latest.at.getTime() > at.getTime()) {
      results.push({ clientRequestId: answer.clientRequestId, status: "stale" });
      continue;
    }

    try {
      const result = await answerCard(
        db,
        userId,
        { cardId: card.id, rating: answer.rating, clientRequestId: answer.clientRequestId, elapsedMs: answer.elapsedMs, typed: answer.typed },
        at,
      );
      results.push({ clientRequestId: answer.clientRequestId, status: result.duplicate ? "duplicate" : "stored" });
    } catch (error) {
      if (error instanceof CardNotFoundError) results.push({ clientRequestId: answer.clientRequestId, status: "missing" });
      else throw error;
    }
  }
  return results;
}
