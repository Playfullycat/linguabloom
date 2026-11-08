import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, real, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";

/**
 * CEFR-aligned can-do statements (spec §2.1), seeded from the unit files and
 * the level catalog (src/content/can-do). Removed statements are archived so
 * evidence keeps pointing at them.
 */
export const canDoStatements = pgTable(
  "can_do_statements",
  {
    id: text("id").primaryKey(),
    level: text("level").notNull(),
    /** One of the ten skill dimensions (spec §2.1). */
    skill: text("skill").notNull(),
    descriptionEn: text("description_en").notNull(),
    descriptionZh: text("description_zh").notNull(),
    /** "unit:<unit id>" or "catalog". */
    origin: text("origin").notNull(),
    prerequisites: jsonb("prerequisites").$type<string[]>().notNull().default([]),
    /** Which kinds of practice can give evidence (derived from the content when seeding). */
    evidenceTypes: jsonb("evidence_types").$type<string[]>().notNull().default([]),
    /** { minWeight, minDays, minRate, needsMedium } — see modules/abilities/domain/status.ts. */
    passRule: jsonb("pass_rule").$type<{ minWeight: number; minDays: number; minRate: number; needsMedium: boolean }>().notNull(),
    sortOrder: smallint("sort_order").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("can_do_statements_level_idx").on(t.level, t.skill)],
);

/**
 * One piece of evidence for one can-do statement, always pointing at a real
 * practice record (`source` + `source_ref`). Append-only; rows are removed
 * only when the learner deletes the record they came from.
 */
export const canDoEvidence = pgTable(
  "can_do_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    canDoId: text("can_do_id")
      .notNull()
      .references(() => canDoStatements.id),
    /** lesson_step | exercise | material_question | dictation | speaking | writing */
    source: text("source").notNull(),
    /** The id of the practice record (attempt, interaction, session, submission). */
    sourceRef: text("source_ref").notNull(),
    /** pass | fail */
    outcome: text("outcome").notNull(),
    /** low | medium | high */
    confidence: text("confidence").notNull(),
    weight: real("weight").notNull(),
    /** Enough to link back and explain (lesson + step, content id, task id …). */
    detail: jsonb("detail").$type<Record<string, string | number | null>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("can_do_evidence_source_unique").on(t.userId, t.canDoId, t.source, t.sourceRef),
    index("can_do_evidence_user_idx").on(t.userId, t.canDoId, t.occurredAt),
    check("can_do_evidence_outcome_check", sql`${t.outcome} in ('pass','fail')`),
    check("can_do_evidence_confidence_check", sql`${t.confidence} in ('low','medium','high')`),
  ],
);
