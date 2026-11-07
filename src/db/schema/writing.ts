import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";

/**
 * Writing Studio and AI-generated content (spec §5.11, §8.6, §10.3, §10.4).
 */

export const writingSubmissions = pgTable(
  "writing_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Built-in prompt id, or null for the learner's own topic. */
    promptId: text("prompt_id"),
    /** rewrite | diary | email | opinion | summary | free */
    taskType: text("task_type").notNull(),
    /** The task as it was when written (prompts may change later). */
    task: jsonb("task").notNull(),
    level: text("level").notNull(),
    originalText: text("original_text").notNull(),
    feedback: jsonb("feedback"),
    revisedText: text("revised_text"),
    revisionFeedback: jsonb("revision_feedback"),
    rubricVersion: text("rubric_version").notNull(),
    /** low | medium | high (from the AI's own assessment, spec §10.4) */
    confidence: text("confidence"),
    /** draft | feedback | revised */
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revisedAt: timestamp("revised_at", { withTimezone: true }),
  },
  (t) => [
    index("writing_submissions_user_idx").on(t.userId, t.createdAt),
    check("writing_submissions_status_check", sql`${t.status} in ('draft','feedback','revised')`),
  ],
);

/**
 * AI-generated material waiting for (or past) the learner's review:
 * nothing generated reaches the library before it is validated and confirmed.
 */
export const aiGenerations = pgTable(
  "ai_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** graded_reading | material_enrichment | micro_lesson */
    kind: text("kind").notNull(),
    /** What it is for: a material id, an error item id… */
    targetRef: text("target_ref"),
    /** The learner's request (topic, level…). */
    request: jsonb("request").notNull(),
    /** Validated generated content. */
    payload: jsonb("payload").notNull(),
    /** Automatic quality checks that did not block the draft. */
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** draft | published | discarded */
    status: text("status").notNull().default("draft"),
    /** Where it went when published (content id, exercise ids…). */
    resultRef: text("result_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    index("ai_generations_user_idx").on(t.userId, t.kind, t.createdAt),
    check("ai_generations_status_check", sql`${t.status} in ('draft','published','discarded')`),
  ],
);

/** Cached AI word explanations (one per word + sentence), so the same lookup isn't paid twice. */
export const aiDefinitions = pgTable(
  "ai_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    word: text("word").notNull(),
    contextHash: text("context_hash").notNull(),
    result: jsonb("result").notNull(),
    model: text("model").notNull(),
    hits: integer("hits").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("ai_definitions_word_context_unique").on(t.word, t.contextHash)],
);
