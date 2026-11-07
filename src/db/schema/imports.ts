import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { learningContents } from "./materials";

/**
 * Content Importer (spec §5.14, §9.5): the learner's own texts, subtitles,
 * word lists and audio. Imports start as drafts; nothing reaches the
 * learning library before the learner confirms the preview.
 */

/** Uploaded audio, stored under STORAGE_ROOT/media and served only to its owner. */
export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  /** Relative to STORAGE_ROOT. */
  storagePath: text("storage_path").notNull(),
  originalName: text("original_name").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contentImports = pgTable(
  "content_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** paste | txt | markdown | srt | vtt | csv | tsv */
    sourceKind: text("source_kind").notNull(),
    /** reading | listening | vocabulary */
    purpose: text("purpose").notNull(),
    title: text("title").notNull(),
    fileName: text("file_name"),
    /** own_work | personal_use_only | public_domain | licensed */
    copyrightStatus: text("copyright_status").notNull(),
    sourceNote: text("source_note"),
    /** draft | published | discarded */
    status: text("status").notNull().default("draft"),
    /** Parsed preview: segments or word rows, warnings, statistics. */
    parsed: jsonb("parsed").notNull(),
    suggestedLevel: text("suggested_level"),
    mediaAssetId: uuid("media_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    contentId: text("content_id").references(() => learningContents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    index("content_imports_user_idx").on(t.userId, t.createdAt),
    check("content_imports_status_check", sql`${t.status} in ('draft','published','discarded')`),
  ],
);
