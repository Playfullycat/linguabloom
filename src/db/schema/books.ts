import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";

/**
 * Book recommendations for extensive reading (seeded from src/content/books):
 * bibliographic facts and LinguaBloom's own summary, never the book's text.
 */
export const books = pgTable(
  "books",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    author: text("author").notNull(),
    /** graded_reader | original */
    kind: text("kind").notNull(),
    series: text("series"),
    seriesLevel: text("series_level"),
    cefrLevel: text("cefr_level").notNull(),
    /** e.g. "约 A2–B1" (the publisher's stage mapped to CEFR). */
    levelNote: text("level_note"),
    /** fiction | nonfiction */
    genre: text("genre").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    summaryZh: text("summary_zh").notNull(),
    whyZh: text("why_zh").notNull(),
    /** The original work is in the public domain (a retold graded reader is not). */
    publicDomain: boolean("public_domain").notNull().default(false),
    sortOrder: smallint("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("books_kind_check", sql`${t.kind} in ('graded_reader','original')`),
    check("books_genre_check", sql`${t.genre} in ('fiction','nonfiction')`),
  ],
);

/** The learner's shelf: want to read, reading, finished. */
export const userBooks = pgTable(
  "user_books",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.userId, t.bookId] }), check("user_books_status_check", sql`${t.status} in ('want','reading','finished')`)],
);

/** Time spent reading a book (reported by the learner), counted as meaning-focused input. */
export const bookReadingLogs = pgTable(
  "book_reading_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    minutes: smallint("minutes").notNull(),
    pages: smallint("pages"),
    clientRequestId: uuid("client_request_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("book_reading_logs_user_idx").on(t.userId, t.createdAt),
    check("book_reading_logs_minutes_check", sql`${t.minutes} between 1 and 600`),
    check("book_reading_logs_pages_check", sql`${t.pages} is null or ${t.pages} between 1 and 2000`),
  ],
);
