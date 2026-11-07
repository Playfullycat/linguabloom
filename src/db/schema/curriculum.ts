import { sql } from "drizzle-orm";
import { check, integer, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

/**
 * CEFR levels (spec §3.1, §8.2 `levels`). Seeded from the versioned file
 * `src/db/seed/data/cefr-levels.json`; never edited in page code.
 */
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
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [check("cefr_levels_code_check", sql`${t.code} in ('pre_a1','a1','a2','b1','b2','c1','c2')`)],
);
