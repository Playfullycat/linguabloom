import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/db/connection";
import { reviewCards, reviewLogs, userVocabulary, users } from "@/db/schema";
import { runSeeds } from "@/db/seed";
import { getTestDatabaseUrl, truncateAll } from "@/test/db";

import { RATING } from "../domain/cards";
import { answerCard, getReviewQueue, getReviewStats, listVocabulary, replayCardState } from "./review";
import { addCardType, addEntriesForUser, addWordsFromLesson, setCardSuspended } from "./vocabulary";

const url = getTestDatabaseUrl();
const { db, client } = createDb(url, { max: 4 });
const TZ = "Asia/Shanghai";
const HELLO = "pre-a1-u03-hello";

let userA: string;
let userB: string;

beforeAll(async () => {
  await truncateAll(url);
  await runSeeds(url, () => {});
});

beforeEach(async () => {
  await db.delete(users); // cascades vocabulary, cards and logs
  [{ id: userA }] = await db.insert(users).values({ name: "A", email: "a@example.test" }).returning({ id: users.id });
  [{ id: userB }] = await db.insert(users).values({ name: "B", email: "b@example.test" }).returning({ id: users.id });
});

afterAll(() => client.end());

const cardsOf = (userId: string, entryId: string) =>
  db.select().from(reviewCards).where(and(eq(reviewCards.userId, userId), eq(reviewCards.entryId, entryId)));

describe("adding words", () => {
  it("adds lesson vocabulary with recognition + recall cards, once", async () => {
    const added = await addWordsFromLesson(db, userA, `${HELLO}-l1`, ["hello", "hi", "good-morning"]);
    expect(added).toBe(3);
    expect(await addWordsFromLesson(db, userA, `${HELLO}-l1`, ["hello"])).toBe(0);

    const cards = await cardsOf(userA, `${HELLO}.hello`);
    expect(cards.map((c) => c.cardType).sort()).toEqual(["recall", "recognition"]);
    const [vocab] = await db.select().from(userVocabulary).where(eq(userVocabulary.entryId, `${HELLO}.hello`));
    expect(vocab).toMatchObject({ status: "new", addedFrom: `lesson:${HELLO}-l1` });
  });

  it("creates extra card types only on demand, and only when available", async () => {
    await addEntriesForUser(db, userA, [`${HELLO}.good-morning`], "manual");
    expect(await addCardType(db, userA, `${HELLO}.good-morning`, "cloze")).toBe(true);
    expect(await addCardType(db, userA, `${HELLO}.good-morning`, "cloze")).toBe(false); // already exists
    expect((await cardsOf(userA, `${HELLO}.good-morning`)).length).toBe(3);
  });
});

describe("answering cards", () => {
  async function firstQueuedCard(userId: string, now: Date) {
    const { cards } = await getReviewQueue(db, userId, now, TZ);
    return cards[0]!;
  }

  it("appends a log, updates FSRS state and is idempotent", async () => {
    await addEntriesForUser(db, userA, [`${HELLO}.hello`], "manual");
    const now = new Date();
    const card = await firstQueuedCard(userA, now);
    const requestId = randomUUID();

    const first = await answerCard(db, userA, { cardId: card.id, rating: RATING.Good, clientRequestId: requestId, typed: card.text }, now);
    const again = await answerCard(db, userA, { cardId: card.id, rating: RATING.Good, clientRequestId: requestId, typed: card.text }, now);
    expect(again).toMatchObject({ duplicate: true, rating: first.rating, dueAt: first.dueAt });

    const logs = await db.select().from(reviewLogs).where(eq(reviewLogs.cardId, card.id));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.algorithmVersion).toMatch(/^ts-fsrs@6/);
    const [stored] = await db.select().from(reviewCards).where(eq(reviewCards.id, card.id));
    expect(stored!.reps).toBe(1);
    expect(new Date(first.dueAt).getTime()).toBeGreaterThan(now.getTime());
  });

  it("enforces ratings for typed cards on the server", async () => {
    await addEntriesForUser(db, userA, [`${HELLO}.good-morning`], "manual");
    const [recall] = (await cardsOf(userA, `${HELLO}.good-morning`)).filter((c) => c.cardType === "recall");
    const now = new Date();

    const wrong = await answerCard(db, userA, { cardId: recall!.id, rating: RATING.Easy, clientRequestId: randomUUID(), typed: "good evening" }, now);
    expect(wrong).toMatchObject({ answerCorrect: false, rating: RATING.Again });

    const later = new Date(now.getTime() + 2 * 60_000);
    const hinted = await answerCard(
      db,
      userA,
      { cardId: recall!.id, rating: RATING.Easy, clientRequestId: randomUUID(), typed: "Good morning", hintUsed: true },
      later,
    );
    expect(hinted).toMatchObject({ answerCorrect: true, rating: RATING.Hard });
  });

  it("can rebuild the stored state by replaying the log, even after a scheduler version change", async () => {
    await addEntriesForUser(db, userA, [`${HELLO}.hi`], "manual");
    const [card] = (await cardsOf(userA, `${HELLO}.hi`)).filter((c) => c.cardType === "recognition");
    const t0 = new Date();
    const steps = [RATING.Again, RATING.Good, RATING.Good, RATING.Hard];
    for (const [i, rating] of steps.entries()) {
      await answerCard(db, userA, { cardId: card!.id, rating, clientRequestId: randomUUID() }, new Date(t0.getTime() + i * 30 * 60_000));
    }
    // Pretend the card was last scheduled by an older configuration: history must stay valid.
    await db.update(reviewCards).set({ schedulerVersion: "old-version" }).where(eq(reviewCards.id, card!.id));
    await answerCard(db, userA, { cardId: card!.id, rating: RATING.Good, clientRequestId: randomUUID() }, new Date(t0.getTime() + 5 * 86_400_000));

    const [stored] = await db.select().from(reviewCards).where(eq(reviewCards.id, card!.id));
    expect(await replayCardState(db, userA, card!.id)).toEqual(stored!.fsrsState);
    expect(await db.select().from(reviewLogs).where(eq(reviewLogs.cardId, card!.id))).toHaveLength(5);
  });
});

describe("the queue", () => {
  it("shows one card per word and buries siblings after a review", async () => {
    await addEntriesForUser(db, userA, [`${HELLO}.hello`, `${HELLO}.hi`], "manual");
    const now = new Date();
    const first = await getReviewQueue(db, userA, now, TZ);
    expect(first.cards.map((c) => c.entryId).sort()).toEqual([`${HELLO}.hello`, `${HELLO}.hi`]);

    const helloCard = first.cards.find((c) => c.entryId === `${HELLO}.hello`)!;
    await answerCard(db, userA, { cardId: helloCard.id, rating: RATING.Easy, clientRequestId: randomUUID(), typed: "hello" }, now);

    const second = await getReviewQueue(db, userA, new Date(now.getTime() + 60_000), TZ);
    expect(second.cards.some((c) => c.entryId === `${HELLO}.hello`)).toBe(false); // sibling buried
    const tomorrow = await getReviewQueue(db, userA, new Date(now.getTime() + 13 * 3_600_000), TZ);
    expect(tomorrow.cards.some((c) => c.entryId === `${HELLO}.hello`)).toBe(true);
  });

  it("skips suspended cards and respects the daily new-card limit", async () => {
    const entries = [
      "hello", "hi", "good-morning", "good-afternoon", "good-evening", "good-night", "how-are-you", "im-fine-thank-you",
      "im-good-thanks", "not-bad", "and-you", "goodbye", "bye", "see-you-tomorrow", "thank-you", "youre-welcome",
      "sorry", "excuse-me", "have-a-nice-day",
    ].map((k) => `${HELLO}.${k}`);
    await addEntriesForUser(db, userA, entries, "manual");
    await addEntriesForUser(db, userA, ["pre-a1-u04-my-name-is.teacher", "pre-a1-u04-my-name-is.doctor"], "manual");
    const queue = await getReviewQueue(db, userA, new Date(), TZ);
    expect(queue.cards.length).toBe(20);
    expect(queue.newWaiting).toBeGreaterThan(0);

    const [card] = await cardsOf(userA, `${HELLO}.hello`);
    await setCardSuspended(db, userA, card!.id, true);
    const after = await getReviewQueue(db, userA, new Date(), TZ);
    expect(after.cards.some((c) => c.id === card!.id)).toBe(false);
  });
});

describe("scope and stats", () => {
  it("never mixes learners", async () => {
    await addEntriesForUser(db, userA, [`${HELLO}.hello`], "manual");
    expect((await getReviewQueue(db, userB, new Date(), TZ)).cards).toEqual([]);
    expect(await listVocabulary(db, userB, {})).toEqual([]);
    const [cardA] = await cardsOf(userA, `${HELLO}.hello`);
    await expect(answerCard(db, userB, { cardId: cardA!.id, rating: RATING.Good, clientRequestId: randomUUID() })).rejects.toThrow();
  });

  it("reports due counts and word statuses", async () => {
    await addEntriesForUser(db, userA, [`${HELLO}.hello`, `${HELLO}.hi`], "manual");
    const stats = await getReviewStats(db, userA, new Date(), TZ);
    expect(stats).toMatchObject({ totalWords: 2, byStatus: { new: 2 }, dueNow: 0, newWaiting: 4 });
    expect(stats.retention.map((r) => r.days)).toEqual([7, 30, 90]);
  });
});
