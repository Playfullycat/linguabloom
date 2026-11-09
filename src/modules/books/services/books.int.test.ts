import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/db/connection";
import { books, skillEstimates, userBooks, users } from "@/db/schema";
import { runSeeds } from "@/db/seed";
import { getTestDatabaseUrl, truncateAll } from "@/test/db";
import { getWeeklyActivity } from "@/modules/study-plan/services/activity";

import { BookNotFoundError, getBookshelf, logReading, setBookStatus } from "./books";

const url = getTestDatabaseUrl();
const { db, client } = createDb(url, { max: 4 });
const weekStart = new Date(Date.now() - 3 * 86_400_000);

let userA: string;
let userB: string;

beforeAll(async () => {
  await truncateAll(url);
  await runSeeds(url, () => {});
});

beforeEach(async () => {
  await db.delete(users);
  [{ id: userA }] = await db.insert(users).values({ name: "A", email: "a@example.test" }).returning({ id: users.id });
  [{ id: userB }] = await db.insert(users).values({ name: "B", email: "b@example.test" }).returning({ id: users.id });
});

afterAll(() => client.end());

describe("book recommendations", () => {
  it("seeds the list and recommends by reading level: easy at or just below, stretch one above", async () => {
    expect(await db.select().from(books)).toHaveLength(41);
    const beginner = await getBookshelf(db, userA, weekStart);
    expect(beginner.learner.level).toBe("pre_a1");
    expect(beginner.easy.length).toBeGreaterThan(0);
    expect(beginner.easy.every((b) => b.level === "pre_a1")).toBe(true);
    expect(beginner.stretch.every((b) => b.level === "a1")).toBe(true);

    await db.insert(skillEstimates).values({ userId: userA, skill: "reading", estimatedLevel: "b1", confidence: "medium", evidenceCount: 5, source: "test" });
    const b1 = await getBookshelf(db, userA, weekStart);
    expect(b1.learner.level).toBe("b1");
    expect(b1.easy.every((b) => b.level === "b1" || b.level === "a2")).toBe(true);
    // The learner's own level first; up to B1, graded readers before originals.
    expect(b1.easy[0]).toMatchObject({ level: "b1", kind: "graded_reader" });
    expect(b1.stretch.every((b) => b.level === "b2")).toBe(true);
    expect(b1.all).toHaveLength(41);
  });

  it("keeps a shelf: want → reading → finished, off the shelf, per learner", async () => {
    const t0 = new Date("2026-11-01T10:00:00Z");
    await setBookStatus(db, userA, "holes", "want", t0);
    let [row] = await db.select().from(userBooks).where(and(eq(userBooks.userId, userA), eq(userBooks.bookId, "holes")));
    expect(row).toMatchObject({ status: "want", startedAt: null, finishedAt: null });

    await setBookStatus(db, userA, "holes", "reading", new Date("2026-11-02T10:00:00Z"));
    await setBookStatus(db, userA, "holes", "finished", new Date("2026-11-05T10:00:00Z"));
    [row] = await db.select().from(userBooks).where(eq(userBooks.bookId, "holes"));
    expect(row).toMatchObject({ status: "finished", startedAt: new Date("2026-11-02T10:00:00Z"), finishedAt: new Date("2026-11-05T10:00:00Z") });

    const shelf = await getBookshelf(db, userA, weekStart);
    expect(shelf.finished.map((b) => b.id)).toEqual(["holes"]);
    expect(shelf.stats.finished).toBe(1);
    expect(shelf.easy.some((b) => b.id === "holes")).toBe(false); // on the shelf: not recommended again
    expect((await getBookshelf(db, userB, weekStart)).finished).toEqual([]);

    await setBookStatus(db, userA, "holes", null);
    expect(await db.select().from(userBooks)).toHaveLength(0);
    await expect(setBookStatus(db, userA, "no-such-book", "want")).rejects.toBeInstanceOf(BookNotFoundError);
  });

  it("logs reading time once per request, starts the book and counts it as input", async () => {
    await setBookStatus(db, userA, "matilda", "want");
    const input = { bookId: "matilda", minutes: 25, pages: 18, clientRequestId: randomUUID() };
    expect(await logReading(db, userA, input)).toEqual({ duplicate: false });
    expect(await logReading(db, userA, input)).toEqual({ duplicate: true });
    await logReading(db, userA, { bookId: "matilda", minutes: 15, clientRequestId: randomUUID() });

    const shelf = await getBookshelf(db, userA, weekStart);
    expect(shelf.reading.map((b) => b.id)).toEqual(["matilda"]);
    expect(shelf.reading[0]).toMatchObject({ minutes: 40, pages: 18 });
    expect(shelf.stats).toMatchObject({ minutesThisWeek: 40, minutesTotal: 40 });

    const week = await getWeeklyActivity(db, userA, new Date(), "UTC");
    expect(week.byStrand.meaning_focused_input).toBe(40);
    expect((await getWeeklyActivity(db, userB, new Date(), "UTC")).byStrand.meaning_focused_input).toBe(0);
    await expect(logReading(db, userA, { bookId: "nope", minutes: 5, clientRequestId: randomUUID() })).rejects.toBeInstanceOf(BookNotFoundError);
  });
});
