import { sql } from "drizzle-orm";
import { z } from "zod";

import { CEFR_LEVELS } from "../../modules/curriculum/domain/cefr";
import type { DbExecutor } from "../connection";
import { cefrLevels } from "../schema";
import data from "./data/cefr-levels.json" with { type: "json" };
import type { Seed } from "./types";

const fileSchema = z.object({
  content_schema_version: z.literal(1),
  source_type: z.enum(["first_party", "licensed", "public_domain"]),
  source_reference: z.string().min(1),
  levels: z
    .array(
      z.object({
        code: z.enum(CEFR_LEVELS),
        label: z.string().min(1),
        stage_goal_zh: z.string().min(1),
        focus_zh: z.string().min(1),
      }),
    )
    .length(CEFR_LEVELS.length)
    .refine((levels) => levels.every((l, i) => l.code === CEFR_LEVELS[i]), "levels must be listed in CEFR order"),
});

export const cefrLevelsSeed: Seed = {
  name: "cefr-levels",
  async run(db: DbExecutor) {
    const file = fileSchema.parse(data);
    const rows = file.levels.map((level, index) => ({
      code: level.code,
      sortOrder: index + 1,
      label: level.label,
      stageGoalZh: level.stage_goal_zh,
      focusZh: level.focus_zh,
      sourceType: file.source_type,
      contentSchemaVersion: file.content_schema_version,
    }));

    // Idempotent: re-running updates text in place, never duplicates.
    await db
      .insert(cefrLevels)
      .values(rows)
      .onConflictDoUpdate({
        target: cefrLevels.code,
        set: {
          sortOrder: sql`excluded.sort_order`,
          label: sql`excluded.label`,
          stageGoalZh: sql`excluded.stage_goal_zh`,
          focusZh: sql`excluded.focus_zh`,
          sourceType: sql`excluded.source_type`,
          contentSchemaVersion: sql`excluded.content_schema_version`,
          updatedAt: sql`now()`,
        },
      });
    return { rows: rows.length };
  },
};
