import { and, eq, isNull, notInArray, sql } from "drizzle-orm";

import { loadPte } from "../../modules/pte/content";
import type { DbExecutor } from "../connection";
import { examVersions, ptePrompts, pteRubrics, pteTaskTypes } from "../schema";
import type { Seed } from "./types";

/**
 * PTE exam versions, their task types and rubrics, and the original prompts.
 * Versions are upserted (never deleted: attempts point at them). A prompt
 * whose content changed gets a new content_version, so attempts keep the
 * version they saw; prompts removed from the files are archived.
 */
export const pteSeed: Seed = {
  name: "pte",
  async run(db: DbExecutor) {
    const { versions, prompts } = loadPte();
    let rows = 0;
    // Only one current version: clear the flag first, then set it from the files.
    await db.update(examVersions).set({ isCurrent: false });
    for (const v of versions) {
      const values = {
        id: v.id,
        exam: v.exam,
        labelZh: v.label_zh,
        effectiveFrom: v.effective_from,
        reviewedOn: v.reviewed_on,
        sources: v.sources,
        notesZh: v.notes_zh,
        isCurrent: v.is_current,
        updatedAt: new Date(),
      };
      const { id: _id, ...update } = values;
      void _id;
      await db.insert(examVersions).values(values).onConflictDoUpdate({ target: examVersions.id, set: update });
      for (const t of v.task_types) {
        const row = {
          examVersionId: v.id,
          code: t.code,
          section: t.section,
          sortOrder: t.order,
          nameEn: t.name_en,
          nameZh: t.name_zh,
          skills: t.skills,
          timing: t.timing,
          scoring: t.scoring,
          descriptionZh: t.description_zh,
          tipsZh: t.tips_zh,
          practiceAvailable: t.practice,
        };
        const { examVersionId: _v, code: _c, ...set } = row;
        void _v;
        void _c;
        await db.insert(pteTaskTypes).values(row).onConflictDoUpdate({ target: [pteTaskTypes.examVersionId, pteTaskTypes.code], set });
        rows += 1;
      }
      for (const r of v.rubrics) {
        const row = { id: r.id, examVersionId: v.id, taskCode: r.task_code, rubricVersion: r.rubric_version, traits: r.traits.map((x) => ({ key: x.key, nameZh: x.name_zh, descriptionZh: x.description_zh })) };
        const { id: _id2, ...set } = row;
        void _id2;
        await db.insert(pteRubrics).values(row).onConflictDoUpdate({ target: pteRubrics.id, set });
      }
    }

    for (const p of prompts) {
      const [existing] = await db.select({ hash: ptePrompts.contentHash, version: ptePrompts.contentVersion }).from(ptePrompts).where(eq(ptePrompts.id, p.id));
      const contentVersion = !existing ? 1 : existing.hash === p.hash ? existing.version : existing.version + 1;
      const row = {
        id: p.id,
        taskCode: p.task,
        difficulty: p.difficulty,
        titleZh: p.titleZh,
        content: p.content,
        contentVersion,
        contentHash: p.hash,
        reviewStatus: p.reviewStatus,
        archivedAt: null,
        updatedAt: new Date(),
      };
      const { id: _id, ...set } = row;
      void _id;
      await db.insert(ptePrompts).values(row).onConflictDoUpdate({ target: ptePrompts.id, set });
      rows += 1;
    }
    await db
      .update(ptePrompts)
      .set({ archivedAt: sql`now()` })
      .where(and(isNull(ptePrompts.archivedAt), notInArray(ptePrompts.id, prompts.map((p) => p.id))));
    return { rows };
  },
};
