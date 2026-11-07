import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";

/**
 * Curriculum (spec §8.2). Content rows are written ONLY by the seed from the
 * reviewed files in content/; learner rows (progress, attempts) by the app.
 * Content ids are stable slugs so seeds can be re-run safely.
 */

const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

/** CEFR levels (spec §3.1). */
export const cefrLevels = pgTable(
  "cefr_levels",
  {
    /** pre_a1 | a1 | a2 | b1 | b2 | c1 | c2 */
    code: text("code").primaryKey(),
    sortOrder: smallint("sort_order").notNull().unique(),
    label: text("label").notNull(),
    stageGoalZh: text("stage_goal_zh").notNull(),
    focusZh: text("focus_zh").notNull(),
    sourceType: text("source_type").notNull(),
    contentSchemaVersion: integer("content_schema_version").notNull(),
    updatedAt,
  },
  (t) => [check("cefr_levels_code_check", sql`${t.code} in ('pre_a1','a1','a2','b1','b2','c1','c2')`)],
);

export const courses = pgTable("courses", {
  id: text("id").primaryKey(),
  titleEn: text("title_en").notNull(),
  titleZh: text("title_zh").notNull(),
  summaryZh: text("summary_zh").notNull(),
  sourceType: text("source_type").notNull(),
  contentSchemaVersion: integer("content_schema_version").notNull(),
  updatedAt,
});

/** planned = in the catalog only; published = learnable. Review status is separate (spec §16.16). */
export const units = pgTable(
  "units",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    level: text("level")
      .notNull()
      .references(() => cefrLevels.code),
    sortOrder: smallint("sort_order").notNull(),
    titleEn: text("title_en").notNull(),
    titleZh: text("title_zh").notNull(),
    summaryZh: text("summary_zh").notNull(),
    status: text("status").notNull(),
    reviewStatus: text("review_status").notNull(),
    sourceType: text("source_type").notNull(),
    /** can_do, grammar_points, vocabulary (validated content). */
    content: jsonb("content"),
    contentSchemaVersion: integer("content_schema_version").notNull(),
    updatedAt,
  },
  (t) => [
    unique("units_course_level_order_unique").on(t.courseId, t.level, t.sortOrder),
    check("units_status_check", sql`${t.status} in ('planned','draft','published','archived')`),
  ],
);

export const lessons = pgTable(
  "lessons",
  {
    id: text("id").primaryKey(),
    unitId: text("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    sortOrder: smallint("sort_order").notNull(),
    kind: text("kind").notNull(),
    titleEn: text("title_en").notNull(),
    titleZh: text("title_zh").notNull(),
    estimatedMinutes: smallint("estimated_minutes").notNull(),
    objectives: jsonb("objectives").notNull(),
    canDoIds: jsonb("can_do_ids").notNull(),
    /** Set when a lesson disappears from the content files (history is kept). */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    updatedAt,
  },
  (t) => [index("lessons_unit_id_idx").on(t.unitId), check("lessons_kind_check", sql`${t.kind} in ('core','review')`)],
);

export const lessonSteps = pgTable(
  "lesson_steps",
  {
    /** "<lessonId>.<stepId>", e.g. "pre-a1-u03-hello-l1.s04". */
    id: text("id").primaryKey(),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    sortOrder: smallint("sort_order").notNull(),
    stepType: text("step_type").notNull(),
    role: text("role").notNull(),
    skill: text("skill").notNull(),
    /** Requires an answer (objective or open task). */
    assessed: boolean("assessed").notNull(),
    content: jsonb("content").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    updatedAt,
  },
  (t) => [index("lesson_steps_lesson_id_idx").on(t.lessonId)],
);

export const LESSON_PROGRESS_STATUSES = ["in_progress", "completed"] as const;

export const learnerLessonProgress = pgTable(
  "learner_lesson_progress",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    status: text("status").$type<(typeof LESSON_PROGRESS_STATUSES)[number]>().notNull(),
    currentStepKey: text("current_step_key"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completionRatio: real("completion_ratio").notNull().default(0),
    /** Share of assessed objective steps answered correctly on the first try. */
    masteryEstimate: real("mastery_estimate"),
    updatedAt,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.lessonId] }),
    check("learner_lesson_progress_status_check", sql`${t.status} in ('in_progress','completed')`),
  ],
);

/**
 * Append-only log of every step completion / answer (spec §5.3). Never
 * updated. `client_request_id` makes retried submissions idempotent.
 */
export const lessonStepAttempts = pgTable(
  "lesson_step_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    attemptNo: integer("attempt_no").notNull(),
    response: jsonb("response").notNull(),
    /** null for non-assessed steps and open tasks. */
    isCorrect: boolean("is_correct"),
    /** Self-assessment share for open tasks (0–1), null otherwise. */
    selfScore: real("self_score"),
    durationMs: integer("duration_ms"),
    clientRequestId: uuid("client_request_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lesson_step_attempts_user_lesson_idx").on(t.userId, t.lessonId, t.stepKey)],
);
