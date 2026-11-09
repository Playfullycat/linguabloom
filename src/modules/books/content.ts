import { z } from "zod";

import list from "../../content/books/books.json" with { type: "json" };
import { CEFR_LEVELS } from "../curriculum/domain/cefr";

/**
 * Book recommendations (src/content/books/books.json): bibliographic facts
 * plus our own short summary and reason. Graded readers must name their
 * series and stage.
 */

const text = z.string().trim().min(1);

export const bookSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: text,
    author: text,
    kind: z.enum(["graded_reader", "original"]),
    series: text.optional(),
    series_level: text.optional(),
    level: z.enum(CEFR_LEVELS),
    level_note: text.optional(),
    genre: z.enum(["fiction", "nonfiction"]),
    tags: z.array(text).max(6),
    summary_zh: text.max(120),
    why_zh: text.max(160),
    public_domain: z.boolean(),
  })
  .refine((b) => b.kind !== "graded_reader" || (b.series && b.series_level), "graded readers need a series and stage");

export type BookContent = z.infer<typeof bookSchema>;

const fileSchema = z
  .object({
    version: z.number().int(),
    source_type: z.literal("first_party"),
    review_status: z.enum(["unreviewed", "pending_owner_review", "reviewed"]),
    note: z.string(),
    books: z.array(bookSchema).min(1),
  })
  .superRefine((f, ctx) => {
    const ids = f.books.map((b) => b.id);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) ctx.addIssue({ code: "custom", message: `duplicate book id ${dup}` });
  });

export function loadBooks(): BookContent[] {
  return fileSchema.parse(list).books;
}
