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
import { units } from "./curriculum";

/**
 * Vocabulary and spaced review (spec §2.3, §2.4, §8.3).
 * Entries come from reviewed content (seed); everything else is per learner.
 */

const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

export const vocabularyEntries = pgTable(
  "vocabulary_entries",
  {
    /** "<unitId>.<key>", e.g. "pre-a1-u03-hello.good-morning". */
    id: text("id").primaryKey(),
    unitId: text("unit_id").references(() => units.id, { onDelete: "set null" }),
    key: text("key").notNull(),
    /** Word or chunk as taught, e.g. "Good morning". */
    text: text("text").notNull(),
    partOfSpeech: text("part_of_speech").notNull(),
    ipa: text("ipa"),
    definitionZh: text("definition_zh").notNull(),
    exampleEn: text("example_en").notNull(),
    exampleZh: text("example_zh").notNull(),
    cefrLevel: text("cefr_level").notNull(),
    sourceType: text("source_type").notNull(),
    /** Set for words the learner imported (CSV/TSV); null for reviewed content. */
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    updatedAt,
  },
  (t) => [index("vocabulary_entries_unit_id_idx").on(t.unitId), index("vocabulary_entries_owner_idx").on(t.ownerUserId)],
);

export const VOCABULARY_STATUSES = [
  "new",
  "learning",
  "receptive_known",
  "productive_developing",
  "productive_known",
  "difficult",
  "suspended",
] as const;
export type VocabularyStatus = (typeof VOCABULARY_STATUSES)[number];

export const userVocabulary = pgTable(
  "user_vocabulary",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entryId: text("entry_id")
      .notNull()
      .references(() => vocabularyEntries.id, { onDelete: "cascade" }),
    status: text("status").$type<VocabularyStatus>().notNull().default("new"),
    /** e.g. "lesson:pre-a1-u03-hello-l1" or "manual". */
    addedFrom: text("added_from").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    personalNote: text("personal_note"),
    /** 0–1, from receptive cards' memory stability. */
    receptiveMastery: real("receptive_mastery").notNull().default(0),
    /** 0–1, from productive cards' memory stability. */
    productiveMastery: real("productive_mastery").notNull().default(0),
    updatedAt,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.entryId] }),
    check(
      "user_vocabulary_status_check",
      sql`${t.status} in ('new','learning','receptive_known','productive_developing','productive_known','difficult','suspended')`,
    ),
  ],
);

export const CARD_TYPES = ["recognition", "listening", "recall", "spelling", "cloze"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const reviewCards = pgTable(
  "review_cards",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entryId: text("entry_id")
      .notNull()
      .references(() => vocabularyEntries.id, { onDelete: "cascade" }),
    cardType: text("card_type").$type<CardType>().notNull(),
    /** Complete ts-fsrs card state (JSON, dates as ISO strings). */
    fsrsState: jsonb("fsrs_state").notNull(),
    schedulerVersion: text("scheduler_version").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    /** Mirrors of fsrs_state for querying. 0 new, 1 learning, 2 review, 3 relearning. */
    state: smallint("state").notNull(),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    stability: real("stability").notNull().default(0),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    /** Set after repeated lapses: worth a new example or splitting up (spec §2.3). */
    difficultAt: timestamp("difficult_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt,
  },
  (t) => [
    unique("review_cards_user_entry_type_unique").on(t.userId, t.entryId, t.cardType),
    index("review_cards_user_due_idx").on(t.userId, t.dueAt),
    check("review_cards_type_check", sql`${t.cardType} in ('recognition','listening','recall','spelling','cloze')`),
  ],
);

/**
 * Append-only review history (spec §2.3, §8.3). Never updated or replaced by
 * the current card state; the card state can always be rebuilt from it.
 */
export const reviewLogs = pgTable(
  "review_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: uuid("card_id")
      .notNull()
      .references(() => reviewCards.id, { onDelete: "cascade" }),
    /** 1 Again, 2 Hard, 3 Good, 4 Easy (after server-side enforcement). */
    rating: smallint("rating").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    elapsedMs: integer("elapsed_ms"),
    /** "self" (revealed and self-rated) or "typed". */
    responseMode: text("response_mode").notNull(),
    answerCorrect: boolean("answer_correct"),
    hintUsed: boolean("hint_used").notNull().default(false),
    userAnswer: jsonb("user_answer"),
    stateBefore: jsonb("state_before").notNull(),
    schedulerResult: jsonb("scheduler_result").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    clientRequestId: uuid("client_request_id").notNull().unique(),
  },
  (t) => [
    index("review_logs_card_reviewed_idx").on(t.cardId, t.reviewedAt),
    index("review_logs_user_reviewed_idx").on(t.userId, t.reviewedAt),
    check("review_logs_rating_check", sql`${t.rating} between 1 and 4`),
  ],
);
