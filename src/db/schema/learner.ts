import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";

/**
 * Learner profile, study preferences, placement diagnostic, skill estimates
 * and daily plans (spec §4, §8.1, §8.7).
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const learnerProfiles = pgTable("learner_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  nativeLanguage: text("native_language").notNull().default("zh-CN"),
  /** zh | en | mixed */
  explanationLanguage: text("explanation_language").notNull().default("zh"),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  /** beginner | forgot | read_simple | daily_conversation (self-report, not a level). */
  selfReportedLevel: text("self_reported_level"),
  /** general | conversation | work | travel | exam */
  learningGoals: jsonb("learning_goals").$type<string[]>().notNull().default([]),
  /** Last onboarding step reached (resume point). */
  onboardingStep: text("onboarding_step").notNull().default("welcome"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  profileNotes: text("profile_notes"),
  ...timestamps,
});

export const studyPreferences = pgTable(
  "study_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Default session length: 15 | 25 | 40 | 60. */
    dailyMinutes: smallint("daily_minutes").notNull().default(25),
    weeklyDays: smallint("weekly_days").notNull().default(5),
    newItemsLimit: smallint("new_items_limit").notNull().default(20),
    reviewLimit: smallint("review_limit").notNull().default(200),
    remindersEnabled: boolean("reminders_enabled").notNull().default(false),
    /** Gentle "days learned this week" note on Today (can be turned off). */
    showWeeklyStreak: boolean("show_weekly_streak").notNull().default(true),
    /** Keep AI Tutor conversations (spec §11.2). Off = nothing is stored after each reply. */
    saveAiConversations: boolean("save_ai_conversations").notNull().default(true),
    /** Speaking Lab (spec §11.2): recordings are off by default, transcripts on. Asked again before each session. */
    saveSpeakingAudio: boolean("save_speaking_audio").notNull().default(false),
    saveSpeakingTranscripts: boolean("save_speaking_transcripts").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    check("study_preferences_minutes_check", sql`${t.dailyMinutes} in (15, 25, 40, 60)`),
    check("study_preferences_days_check", sql`${t.weeklyDays} between 1 and 7`),
    check("study_preferences_new_items_check", sql`${t.newItemsLimit} between 0 and 100`),
  ],
);

/** Diagnostic items, seeded from the versioned item bank (spec §4.2). */
export const assessmentItems = pgTable("assessment_items", {
  id: text("id").primaryKey(),
  bankVersion: text("bank_version").notNull(),
  /** vocabulary | grammar | reading | listening */
  skill: text("skill").notNull(),
  /** Vocabulary items: recognition | recall. */
  subskill: text("subskill"),
  cefrLevel: text("cefr_level").notNull(),
  difficulty: real("difficulty").notNull(),
  discrimination: real("discrimination").notNull(),
  /** Prompt, options, answer key and explanation (validated content). */
  content: jsonb("content").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  updatedAt: timestamps.updatedAt,
});

export const assessmentSessions = pgTable(
  "assessment_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bankVersion: text("bank_version").notNull(),
    /** in_progress | completed */
    status: text("status").notNull().default("in_progress"),
    selfReportedLevel: text("self_reported_level"),
    skippedSkills: jsonb("skipped_skills").$type<string[]>().notNull().default([]),
    /** Optional writing sample (kept so the learner can compare later). */
    writingSample: text("writing_sample"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("assessment_sessions_user_idx").on(t.userId, t.startedAt)],
);

export const assessmentAttempts = pgTable(
  "assessment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => assessmentSessions.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => assessmentItems.id),
    skill: text("skill").notNull(),
    cefrLevel: text("cefr_level").notNull(),
    response: jsonb("response").notNull(),
    isCorrect: boolean("is_correct").notNull(),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("assessment_attempts_session_item_unique").on(t.sessionId, t.itemId)],
);

/**
 * Per-skill level estimates with confidence and evidence (spec §4.2).
 * Append-only history; the latest row per skill is the current estimate.
 */
export const skillEstimates = pgTable(
  "skill_estimates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skill: text("skill").notNull(),
    estimatedLevel: text("estimated_level").notNull(),
    /** low | medium | high */
    confidence: text("confidence").notNull(),
    evidenceCount: integer("evidence_count").notNull(),
    /** e.g. "assessment:<session id>" */
    source: text("source").notNull(),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("skill_estimates_user_skill_idx").on(t.userId, t.skill, t.createdAt)],
);

/** One plan per learner per local day. */
export const studyPlans = pgTable(
  "study_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planDate: date("plan_date").notNull(),
    sessionMinutes: smallint("session_minutes").notNull(),
    /** normal | review_only */
    mode: text("mode").notNull().default("normal"),
    /** Learner returned after a break: lighter plan, gentle welcome. */
    comeback: boolean("comeback").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("study_plans_user_date_unique").on(t.userId, t.planDate)],
);

export const studyPlanTasks = pgTable(
  "study_plan_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => studyPlans.id, { onDelete: "cascade" }),
    /** review | lesson | input | output | assessment */
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    href: text("href").notNull(),
    minutes: smallint("minutes").notNull(),
    /** Why this task is recommended (spec §4.4: explainable). */
    reason: text("reason").notNull(),
    /** Lesson id, etc. */
    targetId: text("target_id"),
    sortOrder: smallint("sort_order").notNull(),
    /** pending | skipped (done is derived from real activity) */
    status: text("status").notNull().default("pending"),
    skipReason: text("skip_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("study_plan_tasks_plan_idx").on(t.planId, t.sortOrder)],
);
