import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";

/** One line of a speaking transcript. `item`/`score`: scripted tasks (which sentence, share of its words heard). */
export type SpeakingTranscriptEntry = { role: "learner" | "ai"; text: string; at: string; item?: number; score?: number; interrupted?: boolean };

/**
 * Speaking Lab sessions (spec §5.10, §8.6 speaking_attempts). Transcripts and
 * recordings are kept only with the learner's consent, chosen before starting.
 */
export const speakingAttempts = pgTable(
  "speaking_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** read_aloud | repeat_sentence | short_answer | guided_conversation | roleplay | retelling | opinion */
    taskType: text("task_type").notNull(),
    promptId: text("prompt_id").notNull(),
    /** realtime (WebRTC) | standard (record → transcribe → reply → speech) | typed (no microphone) */
    mode: text("mode").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** Consent given before the session started. */
    saveTranscript: boolean("save_transcript").notNull(),
    saveAudio: boolean("save_audio").notNull(),
    /** CEFR label the teacher spoke at (e.g. "A1"). */
    level: text("level").notNull(),
    /** Empty when transcripts are not saved. */
    transcript: jsonb("transcript").$type<SpeakingTranscriptEntry[]>().notNull().default([]),
    /** Number of learner turns (kept even when the text isn't). */
    learnerTurns: integer("learner_turns").notNull().default(0),
    learnerWords: integer("learner_words").notNull().default(0),
    audioAssetIds: jsonb("audio_asset_ids").$type<string[]>().notNull().default([]),
    evaluation: jsonb("evaluation"),
    confidence: text("confidence"),
    durationSeconds: integer("duration_seconds"),
    /** active | ended */
    status: text("status").notNull().default("active"),
    /** Realtime: SDP exchanges done (each with a fresh single-use credential). */
    connectCount: integer("connect_count").notNull().default(0),
    /** When the last short-lived realtime credential expired (never the credential itself). */
    credentialExpiresAt: timestamp("credential_expires_at", { withTimezone: true }),
    /** completed | user | disconnected | time_limit | error */
    endReason: text("end_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("speaking_attempts_user_idx").on(t.userId, t.createdAt),
    check("speaking_attempts_status_check", sql`${t.status} in ('active','ended')`),
    check("speaking_attempts_mode_check", sql`${t.mode} in ('realtime','standard','typed')`),
  ],
);

