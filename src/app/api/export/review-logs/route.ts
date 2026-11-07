import { asc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { reviewCards, reviewLogs, vocabularyEntries } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { csvResponse, toCsv } from "@/lib/csv";

/** Export the complete, append-only review history (spec §5.4). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const rows = await getDb()
    .select({
      reviewedAt: reviewLogs.reviewedAt,
      word: vocabularyEntries.text,
      cardType: reviewCards.cardType,
      rating: reviewLogs.rating,
      mode: reviewLogs.responseMode,
      correct: reviewLogs.answerCorrect,
      hint: reviewLogs.hintUsed,
      elapsedMs: reviewLogs.elapsedMs,
      algorithm: reviewLogs.algorithmVersion,
    })
    .from(reviewLogs)
    .innerJoin(reviewCards, eq(reviewCards.id, reviewLogs.cardId))
    .innerJoin(vocabularyEntries, eq(vocabularyEntries.id, reviewCards.entryId))
    .where(eq(reviewLogs.userId, user.id))
    .orderBy(asc(reviewLogs.reviewedAt));

  const csv = toCsv(
    ["reviewed_at", "word", "card_type", "rating", "response_mode", "answer_correct", "hint_used", "elapsed_ms", "algorithm_version"],
    rows.map((r) => [r.reviewedAt, r.word, r.cardType, r.rating, r.mode, r.correct, r.hint, r.elapsedMs, r.algorithm]),
  );
  return csvResponse(`linguabloom-review-logs-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
