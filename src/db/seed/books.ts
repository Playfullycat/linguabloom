import { and, isNull, notInArray } from "drizzle-orm";

import { loadBooks } from "../../modules/books/content";
import type { DbExecutor } from "../connection";
import { books } from "../schema";
import type { Seed } from "./types";

/** Book recommendations. Books removed from the list are archived (shelves keep pointing at them). */
export const booksSeed: Seed = {
  name: "books",
  async run(db: DbExecutor) {
    const list = loadBooks();
    for (const [i, b] of list.entries()) {
      const values = {
        id: b.id,
        title: b.title,
        author: b.author,
        kind: b.kind,
        series: b.series ?? null,
        seriesLevel: b.series_level ?? null,
        cefrLevel: b.level,
        levelNote: b.level_note ?? null,
        genre: b.genre,
        tags: b.tags,
        summaryZh: b.summary_zh,
        whyZh: b.why_zh,
        publicDomain: b.public_domain,
        sortOrder: i,
        archivedAt: null,
      };
      const { id: _id, ...update } = values;
      void _id;
      await db.insert(books).values(values).onConflictDoUpdate({ target: books.id, set: update });
    }
    await db
      .update(books)
      .set({ archivedAt: new Date() })
      .where(and(isNull(books.archivedAt), notInArray(books.id, list.map((b) => b.id))));
    return { rows: list.length };
  },
};
