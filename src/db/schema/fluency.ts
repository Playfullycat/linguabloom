import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { learningContents } from "./materials";

/**
 * One timed round of a fluency activity. `wpm` is worked out on the server
 * from the text's word count; `limitMs` and `rating` belong to timed retelling.
 */
export type FluencyRound = { ms: number; wpm?: number; limitMs?: number; rating?: "smooth" | "ok" | "stuck" };

/**
 * Fluency development (spec §2.2, Nation's fourth strand): speed reading,
 * repeated reading aloud and 4/3/2 timed retelling, always on a text the
 * learner already knows. Only finished activities are stored (one row each).
 */
export const fluencyAttempts = pgTable(
  "fluency_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** speed_reading | repeated_reading | timed_retell */
    kind: text("kind").notNull(),
    contentId: text("content_id")
      .notNull()
      .references(() => learningContents.id, { onDelete: "cascade" }),
    /** CEFR code of the text at the time. */
    level: text("level").notNull(),
    wordCount: integer("word_count").notNull(),
    rounds: jsonb("rounds").$type<FluencyRound[]>().notNull(),
    /** Speed reading: comprehension check after the text is hidden. */
    correctCount: smallint("correct_count"),
    questionCount: smallint("question_count"),
    /** Active time from the first start to the end (capped), counted as fluency study time. */
    durationMs: integer("duration_ms").notNull(),
    clientRequestId: uuid("client_request_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fluency_attempts_user_idx").on(t.userId, t.createdAt),
    check("fluency_attempts_kind_check", sql`${t.kind} in ('speed_reading','repeated_reading','timed_retell')`),
  ],
);
