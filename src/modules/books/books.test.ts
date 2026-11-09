// @vitest-environment node
import { describe, expect, it } from "vitest";

import { CEFR_LEVELS } from "../curriculum/domain/cefr";
import { bookSchema, loadBooks } from "./content";

describe("book list", () => {
  const books = loadBooks();

  it("covers every level with real choices, graded readers naming their series and stage", () => {
    expect(books.length).toBe(41);
    for (const level of CEFR_LEVELS) expect(books.filter((b) => b.level === level).length, level).toBeGreaterThanOrEqual(4);
    for (const b of books.filter((x) => x.kind === "graded_reader")) {
      expect(b.series, b.id).toBeTruthy();
      expect(b.series_level, b.id).toBeTruthy();
    }
    // Some non-fiction from B2 up, for learners who prefer it.
    expect(books.filter((b) => b.genre === "nonfiction" && CEFR_LEVELS.indexOf(b.level) >= 4).length).toBeGreaterThanOrEqual(3);
  });

  it("rejects a graded reader without a series", () => {
    const base = { id: "x", title: "X", author: "Y", kind: "graded_reader", level: "a1", genre: "fiction", tags: [], summary_zh: "简介", why_zh: "理由", public_domain: false };
    expect(bookSchema.safeParse(base).success).toBe(false);
    expect(bookSchema.safeParse({ ...base, series: "S", series_level: "Stage 1" }).success).toBe(true);
  });
});
