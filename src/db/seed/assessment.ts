import { and, eq, isNull, notInArray, sql } from "drizzle-orm";

import { loadItemBank } from "../../modules/assessment/content";
import type { DbExecutor } from "../connection";
import { assessmentItems } from "../schema";
import type { Seed } from "./types";

/** Loads the placement item bank. Items removed from the file are archived, not deleted. */
export const assessmentSeed: Seed = {
  name: "assessment-items",
  async run(db: DbExecutor) {
    const bank = loadItemBank();
    for (const item of bank.items) {
      await db
        .insert(assessmentItems)
        .values({
          id: item.id,
          bankVersion: bank.bank_version,
          skill: item.skill,
          subskill: item.subskill ?? null,
          cefrLevel: item.level,
          difficulty: item.difficulty,
          discrimination: item.discrimination,
          content: item,
          archivedAt: null,
        })
        .onConflictDoUpdate({
          target: assessmentItems.id,
          set: {
            bankVersion: sql`excluded.bank_version`,
            skill: sql`excluded.skill`,
            subskill: sql`excluded.subskill`,
            cefrLevel: sql`excluded.cefr_level`,
            difficulty: sql`excluded.difficulty`,
            discrimination: sql`excluded.discrimination`,
            content: sql`excluded.content`,
            archivedAt: sql`null`,
          },
        });
    }
    await db
      .update(assessmentItems)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(assessmentItems.bankVersion, bank.bank_version),
          isNull(assessmentItems.archivedAt),
          notInArray(
            assessmentItems.id,
            bank.items.map((i) => i.id),
          ),
        ),
      );
    return { rows: bank.items.length };
  },
};
