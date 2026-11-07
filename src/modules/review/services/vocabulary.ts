import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/connection";
import { lessons, reviewCards, userVocabulary, vocabularyEntries } from "@/db/schema";

import { DEFAULT_CARD_TYPES, availableCardTypes, type ReviewCardType } from "../domain/cards";
import { SCHEDULER_VERSION, getScheduler, serializeCard } from "../domain/scheduler";
import { deriveVocabularyStatus } from "../domain/status";

/**
 * Learner vocabulary: adding words (from lessons or manually), creating review
 * cards on demand, suspending, and keeping the derived status up to date.
 */

export class EntryNotFoundError extends Error {}
export class CardNotFoundError extends Error {}

async function insertCard(db: DbExecutor, userId: string, entryId: string, cardType: ReviewCardType, now: Date): Promise<boolean> {
  const scheduler = await getScheduler();
  const id = randomUUID();
  const card = scheduler.newCard({ now, cardId: id });
  const inserted = await db
    .insert(reviewCards)
    .values({
      id,
      userId,
      entryId,
      cardType,
      fsrsState: serializeCard(card),
      schedulerVersion: SCHEDULER_VERSION,
      dueAt: now,
      state: card.state,
      reps: card.reps,
      lapses: card.lapses,
      stability: card.stability,
      createdAt: now,
    })
    .onConflictDoNothing({ target: [reviewCards.userId, reviewCards.entryId, reviewCards.cardType] })
    .returning({ id: reviewCards.id });
  return inserted.length > 0;
}

/**
 * Add entries to the learner's vocabulary with the default cards
 * (recognition + recall). Words already in the vocabulary are left as they are.
 * Returns how many words were newly added.
 */
export async function addEntriesForUser(
  db: Database,
  userId: string,
  entryIds: string[],
  addedFrom: string,
  now = new Date(),
): Promise<number> {
  if (entryIds.length === 0) return 0;
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: vocabularyEntries.id })
      .from(vocabularyEntries)
      .where(inArray(vocabularyEntries.id, entryIds));
    let added = 0;
    for (const { id: entryId } of existing) {
      const inserted = await tx
        .insert(userVocabulary)
        .values({ userId, entryId, addedFrom, status: "new", firstSeenAt: now })
        .onConflictDoNothing()
        .returning({ entryId: userVocabulary.entryId });
      if (inserted.length === 0) continue;
      added += 1;
      for (const type of DEFAULT_CARD_TYPES) await insertCard(tx, userId, entryId, type, now);
    }
    return added;
  });
}

/** Words introduced in a lesson (vocab steps) go into the learner's review queue. */
export async function addWordsFromLesson(db: Database, userId: string, lessonId: string, vocabularyKeys: string[]) {
  const [lesson] = await db.select({ unitId: lessons.unitId }).from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  if (!lesson || vocabularyKeys.length === 0) return 0;
  return addEntriesForUser(
    db,
    userId,
    vocabularyKeys.map((key) => `${lesson.unitId}.${key}`),
    `lesson:${lessonId}`,
  );
}

/** Opt-in extra card templates for one word (spec: generate on demand). */
export async function addCardType(db: Database, userId: string, entryId: string, cardType: ReviewCardType, now = new Date()) {
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select({ text: vocabularyEntries.text, exampleEn: vocabularyEntries.exampleEn })
      .from(userVocabulary)
      .innerJoin(vocabularyEntries, eq(vocabularyEntries.id, userVocabulary.entryId))
      .where(and(eq(userVocabulary.userId, userId), eq(userVocabulary.entryId, entryId)))
      .limit(1);
    if (!entry) throw new EntryNotFoundError(entryId);
    if (!availableCardTypes(entry).includes(cardType)) throw new EntryNotFoundError(`${cardType} not available for ${entryId}`);
    const created = await insertCard(tx, userId, entryId, cardType, now);
    await refreshVocabularyStatus(tx, userId, entryId);
    return created;
  });
}

export async function setCardSuspended(db: Database, userId: string, cardId: string, suspended: boolean) {
  return db.transaction(async (tx) => {
    const [card] = await tx
      .update(reviewCards)
      .set({ suspendedAt: suspended ? new Date() : null })
      .where(and(eq(reviewCards.id, cardId), eq(reviewCards.userId, userId)))
      .returning({ entryId: reviewCards.entryId });
    if (!card) throw new CardNotFoundError(cardId);
    await refreshVocabularyStatus(tx, userId, card.entryId);
  });
}

/** Recompute a word's status and mastery from all of its cards. */
export async function refreshVocabularyStatus(db: DbExecutor, userId: string, entryId: string) {
  const cards = await db
    .select({
      cardType: reviewCards.cardType,
      state: reviewCards.state,
      reps: reviewCards.reps,
      stability: reviewCards.stability,
      suspendedAt: reviewCards.suspendedAt,
      difficultAt: reviewCards.difficultAt,
    })
    .from(reviewCards)
    .where(and(eq(reviewCards.userId, userId), eq(reviewCards.entryId, entryId)));

  const derived = deriveVocabularyStatus(
    cards.map((c) => ({
      cardType: c.cardType,
      state: c.state,
      reps: c.reps,
      stability: c.stability,
      suspended: c.suspendedAt !== null,
      difficult: c.difficultAt !== null,
    })),
  );

  await db
    .update(userVocabulary)
    .set({ status: derived.status, receptiveMastery: derived.receptiveMastery, productiveMastery: derived.productiveMastery, updatedAt: sql`now()` })
    .where(and(eq(userVocabulary.userId, userId), eq(userVocabulary.entryId, entryId)));
  return derived;
}
