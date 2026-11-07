import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, real, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";

/**
 * Grammar map, exercise bank, and the error notebook (spec §3.6, §5.5, §5.12, §8.4).
 */

const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

export const grammarPoints = pgTable("grammar_points", {
  /** e.g. "be-verb" */
  id: text("id").primaryKey(),
  /** Teaching order (spec §3.7). */
  sortOrder: smallint("sort_order").notNull().unique(),
  level: text("level").notNull(),
  titleEn: text("title_en").notNull(),
  titleZh: text("title_zh").notNull(),
  /** published | planned */
  status: text("status").notNull(),
  topics: jsonb("topics").$type<string[]>().notNull(),
  prerequisiteIds: jsonb("prerequisite_ids").$type<string[]>().notNull(),
  /** Unit grammar points (course content) that teach this point. */
  unitGrammarIds: jsonb("unit_grammar_ids").$type<string[]>().notNull(),
  /** Explanation, structure, usage, examples, breakdowns, common errors, contrast, limits. */
  content: jsonb("content").notNull(),
  defaultErrorCategory: text("default_error_category").notNull(),
  sourceReference: text("source_reference"),
  reviewStatus: text("review_status").notNull(),
  contentVersion: integer("content_version").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  updatedAt,
});

export const exercises = pgTable(
  "exercises",
  {
    /** e.g. "be-verb.e3" */
    id: text("id").primaryKey(),
    grammarPointId: text("grammar_point_id").references(() => grammarPoints.id, { onDelete: "cascade" }),
    /** choice | cloze | order | correction | build */
    exerciseType: text("exercise_type").notNull(),
    skill: text("skill").notNull(),
    cefrLevel: text("cefr_level").notNull(),
    difficulty: real("difficulty").notNull(),
    /** What the learner sees (never the key). */
    prompt: jsonb("prompt").notNull(),
    answerKey: jsonb("answer_key").notNull(),
    explanation: jsonb("explanation").notNull(),
    /** Error category written to the notebook when answered wrongly. */
    errorCategory: text("error_category").notNull(),
    /** exact | normalized | self */
    scoringRule: text("scoring_rule").notNull(),
    sortOrder: smallint("sort_order").notNull(),
    contentVersion: integer("content_version").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    updatedAt,
  },
  (t) => [index("exercises_point_idx").on(t.grammarPointId, t.sortOrder)],
);

/** Append-only. */
export const exerciseAttempts = pgTable(
  "exercise_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id),
    response: jsonb("response").notNull(),
    /** 0–1 (self-assessed share for "build"). */
    score: real("score").notNull(),
    /** null for self-assessed open exercises. */
    isCorrect: boolean("is_correct"),
    feedback: jsonb("feedback"),
    /** practice | remediation | retest */
    context: text("context").notNull(),
    errorItemId: uuid("error_item_id"),
    durationMs: integer("duration_ms"),
    clientRequestId: uuid("client_request_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("exercise_attempts_user_idx").on(t.userId, t.exerciseId, t.createdAt)],
);

export const ERROR_CATEGORIES = [
  "word_form",
  "word_order",
  "tense",
  "agreement",
  "article",
  "preposition",
  "spelling",
  "collocation",
  "pronunciation",
  "listening",
  "pragmatics",
  "comprehension",
  "task",
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/**
 * One recurring mistake: a category + the knowledge point it belongs to
 * (spec §5.12). Occurrences are kept separately, append-only.
 */
export const errorItems = pgTable(
  "error_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    /** grammar | unit_grammar | vocabulary | material */
    pointType: text("point_type").notNull(),
    pointId: text("point_id").notNull(),
    title: text("title").notNull(),
    /** active | retest | resolved */
    status: text("status").notNull().default("active"),
    occurrenceCount: integer("occurrence_count").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastWrong: text("last_wrong"),
    lastCorrect: text("last_correct"),
    remediationPassedAt: timestamp("remediation_passed_at", { withTimezone: true }),
    retestDueAt: timestamp("retest_due_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** How often it came back after being resolved. */
    recurredCount: integer("recurred_count").notNull().default(0),
    note: text("note"),
    updatedAt,
  },
  (t) => [
    unique("error_items_user_point_unique").on(t.userId, t.category, t.pointType, t.pointId),
    index("error_items_user_status_idx").on(t.userId, t.status, t.lastSeenAt),
    check("error_items_status_check", sql`${t.status} in ('active','retest','resolved')`),
  ],
);

export const errorOccurrences = pgTable(
  "error_occurrences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    errorItemId: uuid("error_item_id")
      .notNull()
      .references(() => errorItems.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** lesson | review | grammar | reading | listening */
    source: text("source").notNull(),
    /** e.g. lesson id + step, exercise id, material id + sentence */
    sourceRef: text("source_ref").notNull(),
    wrong: text("wrong"),
    correct: text("correct"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("error_occurrences_item_idx").on(t.errorItemId, t.createdAt)],
);
