import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, primaryKey, real, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";

/**
 * PTE Academic preparation (spec §5.13, §8.8). Task formats and scoring rules
 * change, so everything official is stored per exam version with its sources
 * and review date, and every attempt keeps the version and a snapshot of what
 * it was scored against — adding a new version never rewrites old records.
 */

export const examVersions = pgTable("exam_versions", {
  id: text("id").primaryKey(),
  exam: text("exam").notNull(),
  labelZh: text("label_zh").notNull(),
  /** Null when the official pages don't state it. */
  effectiveFrom: date("effective_from"),
  /** When the official pages were last checked. */
  reviewedOn: date("reviewed_on").notNull(),
  sources: jsonb("sources").$type<{ title: string; url: string }[]>().notNull(),
  notesZh: jsonb("notes_zh").$type<string[]>().notNull().default([]),
  isCurrent: boolean("is_current").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pteTaskTypes = pgTable(
  "pte_task_types",
  {
    examVersionId: text("exam_version_id")
      .notNull()
      .references(() => examVersions.id),
    /** Stable across versions, e.g. r_fib_dropdown. */
    code: text("code").notNull(),
    /** speaking_writing | reading | listening */
    section: text("section").notNull(),
    sortOrder: smallint("sort_order").notNull(),
    nameEn: text("name_en").notNull(),
    nameZh: text("name_zh").notNull(),
    /** Skills the official page says the task contributes to. */
    skills: jsonb("skills").$type<string[]>().notNull(),
    /** Official timing and limits (prep, response, audio length, word limits …). */
    timing: jsonb("timing").notNull(),
    /** Official scoring description plus the method this app uses. */
    scoring: jsonb("scoring").notNull(),
    descriptionZh: text("description_zh").notNull(),
    tipsZh: jsonb("tips_zh").$type<string[]>().notNull().default([]),
    practiceAvailable: boolean("practice_available").notNull(),
  },
  (t) => [primaryKey({ columns: [t.examVersionId, t.code] }), check("pte_task_types_section_check", sql`${t.section} in ('speaking_writing','reading','listening')`)],
);

/** Feedback dimensions for AI-assisted tasks (never presented as Pearson scores). */
export const pteRubrics = pgTable(
  "pte_rubrics",
  {
    id: text("id").primaryKey(),
    examVersionId: text("exam_version_id")
      .notNull()
      .references(() => examVersions.id),
    taskCode: text("task_code").notNull(),
    rubricVersion: text("rubric_version").notNull(),
    traits: jsonb("traits").$type<{ key: string; nameZh: string; descriptionZh: string }[]>().notNull(),
  },
  (t) => [index("pte_rubrics_task_idx").on(t.examVersionId, t.taskCode)],
);

/** Original practice items (spec §5.13: all material original). */
export const ptePrompts = pgTable(
  "pte_prompts",
  {
    id: text("id").primaryKey(),
    taskCode: text("task_code").notNull(),
    difficulty: smallint("difficulty").notNull(),
    titleZh: text("title_zh").notNull(),
    /** Learner-facing content and the answer key, validated per task type. */
    content: jsonb("content").notNull(),
    /** Bumped whenever the content changes; attempts record the version they saw. */
    contentVersion: integer("content_version").notNull(),
    contentHash: text("content_hash").notNull(),
    reviewStatus: text("review_status").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pte_prompts_task_idx").on(t.taskCode)],
);

export const pteAttempts = pgTable(
  "pte_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    examVersionId: text("exam_version_id")
      .notNull()
      .references(() => examVersions.id),
    taskCode: text("task_code").notNull(),
    promptId: text("prompt_id")
      .notNull()
      .references(() => ptePrompts.id),
    promptVersion: integer("prompt_version").notNull(),
    /** practice | timed (| mock in step 4.3) */
    mode: text("mode").notNull(),
    response: jsonb("response").notNull(),
    /** Objective points (null when the task only has AI-assisted feedback). */
    score: real("score"),
    maxScore: real("max_score"),
    /** Per-item marking (each blank / option / word). */
    scoreDetail: jsonb("score_detail"),
    /** AI-assisted feedback, kept apart from objective scoring. */
    feedback: jsonb("feedback"),
    /** What the attempt was scored against (task name, scoring method, prompt title, key) at the time. */
    snapshot: jsonb("snapshot").notNull(),
    durationMs: integer("duration_ms"),
    timeLimitSeconds: integer("time_limit_seconds"),
    /** The timer ran out and the answer was submitted automatically. */
    timedOut: boolean("timed_out").notNull().default(false),
    clientRequestId: uuid("client_request_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pte_attempts_user_idx").on(t.userId, t.taskCode, t.createdAt), check("pte_attempts_mode_check", sql`${t.mode} in ('practice','timed','mock')`)],
);
