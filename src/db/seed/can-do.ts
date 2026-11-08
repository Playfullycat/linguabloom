import { and, isNull, notInArray } from "drizzle-orm";

import { loadCanDo } from "../../modules/abilities/content";
import type { DbExecutor } from "../connection";
import { canDoStatements } from "../schema";
import type { Seed } from "./types";

/**
 * Can-do statements from the unit files and the level catalog, with the kinds
 * of practice that can give evidence. Statements removed from the content are
 * archived (evidence keeps pointing at them).
 */
export const canDoSeed: Seed = {
  name: "can-do",
  async run(db: DbExecutor) {
    const { statements } = loadCanDo();
    const now = new Date();
    for (const s of statements) {
      const values = {
        id: s.id,
        level: s.level,
        skill: s.skill,
        descriptionEn: s.en,
        descriptionZh: s.zh,
        origin: s.origin,
        prerequisites: s.prerequisites,
        evidenceTypes: s.evidenceTypes,
        passRule: s.passRule,
        sortOrder: s.sortOrder,
        archivedAt: null,
        updatedAt: now,
      };
      const { id: _id, ...update } = values;
      void _id;
      await db.insert(canDoStatements).values(values).onConflictDoUpdate({ target: canDoStatements.id, set: update });
    }
    await db
      .update(canDoStatements)
      .set({ archivedAt: now })
      .where(and(isNull(canDoStatements.archivedAt), notInArray(canDoStatements.id, statements.map((s) => s.id))));
    return { rows: statements.length };
  },
};
