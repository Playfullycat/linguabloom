import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";

/**
 * Reading and listening materials (spec §5.6, §5.7, §8.5). Built-in
 * materials come from reviewed JSON files (seed); imported materials (2.3)
 * belong to the learner who imported them.
 */

const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

export const learningContents = pgTable(
  "learning_contents",
  {
    /** e.g. "rd-a1-my-morning" (built-in) or a generated id (imported). */
    id: text("id").primaryKey(),
    /** reading | listening */
    type: text("type").notNull(),
    titleEn: text("title_en").notNull(),
    titleZh: text("title_zh").notNull(),
    summaryZh: text("summary_zh").notNull(),
    cefrLevel: text("cefr_level").notNull(),
    topic: text("topic"),
    /** Word count, sentence length, glossary size… (computed, never AI-guessed in Phase 2). */
    difficultyMetadata: jsonb("difficulty_metadata").notNull(),
    /** first_party | licensed | public_domain | user_import */
    sourceType: text("source_type").notNull(),
    sourceUrl: text("source_url"),
    /** e.g. first_party_original, personal_use_only */
    copyrightStatus: text("copyright_status").notNull(),
    reviewStatus: text("review_status").notNull(),
    /** draft | published | archived */
    status: text("status").notNull(),
    /** null for built-in materials. */
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    durationSeconds: integer("duration_seconds"),
    mediaAssetId: text("media_asset_id"),
    /** Glossary and comprehension questions (with answer keys — server only). */
    content: jsonb("content").notNull(),
    contentVersion: integer("content_version").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt,
  },
  (t) => [
    index("learning_contents_type_level_idx").on(t.type, t.cefrLevel),
    check("learning_contents_type_check", sql`${t.type} in ('reading','listening')`),
    check("learning_contents_status_check", sql`${t.status} in ('draft','published','archived')`),
  ],
);

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentId: text("content_id")
      .notNull()
      .references(() => learningContents.id, { onDelete: "cascade" }),
    sequence: smallint("sequence").notNull(),
    /** Only real timestamps (imported subtitles); never invented. */
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    speaker: text("speaker"),
    textEn: text("text_en").notNull(),
    textZh: text("text_zh"),
    metadata: jsonb("metadata"),
  },
  (t) => [unique("transcript_segments_content_seq_unique").on(t.contentId, t.sequence)],
);

/**
 * What the learner did with a material: open, look up, collect, replay,
 * reveal the transcript, answer, dictate, study time (spec §8.5). Append-only;
 * no unrelated browsing data.
 */
export const contentInteractions = pgTable(
  "content_interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentId: text("content_id")
      .notNull()
      .references(() => learningContents.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    segmentSeq: smallint("segment_seq"),
    payload: jsonb("payload"),
    isCorrect: boolean("is_correct"),
    durationMs: integer("duration_ms"),
    clientRequestId: uuid("client_request_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("content_interactions_user_content_idx").on(t.userId, t.contentId, t.createdAt)],
);

/** Per-learner state of a material: favourite, note, saved sentences, finished. */
export const userContentState = pgTable(
  "user_content_state",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentId: text("content_id")
      .notNull()
      .references(() => learningContents.id, { onDelete: "cascade" }),
    favorite: boolean("favorite").notNull().default(false),
    note: text("note"),
    savedSegments: jsonb("saved_segments").$type<number[]>().notNull().default([]),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt,
  },
  (t) => [primaryKey({ columns: [t.userId, t.contentId] })],
);
