import { index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";

/**
 * AI usage, sessions and messages (spec §7.6, §8.6). Usage rows never hold
 * keys or request bodies; messages are stored only when the learner allows it.
 */

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** tutor_structured | tutor_chat | writing_feedback | … */
    task: text("task").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** USD estimate from configured prices; null when prices are unknown. */
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }),
    latencyMs: integer("latency_ms").notNull(),
    /** ok | error | blocked */
    status: text("status").notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_user_time_idx").on(t.userId, t.createdAt)],
);

export const aiSessions = pgTable(
  "ai_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** Tutor mode, e.g. explain, roleplay, reading_coach. */
    sessionType: text("session_type").notNull(),
    title: text("title").notNull(),
    /** The learning context that was shared with the AI (for transparency). */
    learningContext: jsonb("learning_context").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    estimatedCost: numeric("estimated_cost", { precision: 12, scale: 6, mode: "number" }),
    /** active | ended */
    status: text("status").notNull().default("active"),
  },
  (t) => [index("ai_sessions_user_idx").on(t.userId, t.startedAt)],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => aiSessions.id, { onDelete: "cascade" }),
    /** user | assistant */
    role: text("role").notNull(),
    content: text("content").notNull(),
    transcriptText: text("transcript_text"),
    /** Structured reply (correction, new words, follow-up) for teaching modes. */
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_messages_session_idx").on(t.sessionId, t.createdAt)],
);
