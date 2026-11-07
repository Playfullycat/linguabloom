import { asc } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getTestDatabaseUrl, truncateAll } from "@/test/db";

import { createDb } from "../connection";
import { cefrLevels } from "../schema";
import { runSeeds } from ".";

const url = getTestDatabaseUrl();
const { db, client } = createDb(url, { max: 1 });

beforeEach(() => truncateAll(url));
afterAll(() => client.end());

describe("seeds", () => {
  it("loads the seven CEFR levels in order and is idempotent", async () => {
    const log: string[] = [];
    await runSeeds(url, (line) => log.push(line));
    await runSeeds(url, (line) => log.push(line));

    const rows = await db.select().from(cefrLevels).orderBy(asc(cefrLevels.sortOrder));
    expect(rows.map((r) => r.code)).toEqual(["pre_a1", "a1", "a2", "b1", "b2", "c1", "c2"]);
    expect(rows.every((r) => r.sourceType === "first_party" && r.contentSchemaVersion === 1)).toBe(true);
    const levelLines = log.filter((l) => l.startsWith("seed cefr-levels"));
    expect(levelLines).toEqual(["seed cefr-levels: 7 rows", "seed cefr-levels: 7 rows"]);
    // Every seed reports the same row count on a re-run (idempotent upserts).
    expect(log.slice(0, log.length / 2)).toEqual(log.slice(log.length / 2));
  });
});
