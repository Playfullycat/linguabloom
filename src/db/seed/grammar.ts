import { and, isNull, notInArray, sql } from "drizzle-orm";

import { GRAMMAR_SCHEMA_VERSION, loadGrammar } from "../../modules/grammar/content";
import { splitExercise } from "../../modules/grammar/domain/scoring";
import type { DbExecutor } from "../connection";
import { exercises, grammarPoints } from "../schema";
import type { Seed } from "./types";

/**
 * Loads the grammar map and its exercises. Points and exercises removed from
 * the files are archived (learner attempts keep pointing at them).
 */
export const grammarSeed: Seed = {
  name: "grammar",
  async run(db: DbExecutor) {
    const points = loadGrammar();
    let rows = 0;
    // Move existing rows out of the way of the unique sort_order, so the order can change between versions.
    await db.execute(sql`update grammar_points set sort_order = -sort_order - 1000`);

    for (const p of points) {
      const values = {
        id: p.id,
        sortOrder: p.order,
        level: p.level,
        titleEn: p.title_en,
        titleZh: p.title_zh,
        status: p.status,
        topics: p.topics,
        prerequisiteIds: p.prerequisites,
        unitGrammarIds: p.unit_grammar_ids,
        content: {
          summary_zh: p.summary_zh,
          explanation_zh: p.explanation_zh ?? null,
          structure: p.structure ?? [],
          usage_zh: p.usage_zh ?? [],
          examples: p.examples ?? [],
          breakdowns: p.breakdowns ?? [],
          common_errors: p.common_errors ?? [],
          contrast: p.contrast ?? null,
          limits_zh: p.limits_zh ?? [],
        },
        defaultErrorCategory: p.default_error_category,
        sourceReference: null,
        reviewStatus: p.review_status,
        contentVersion: GRAMMAR_SCHEMA_VERSION,
        archivedAt: null,
      };
      const { id: _id, ...update } = values;
      void _id;
      await db.insert(grammarPoints).values(values).onConflictDoUpdate({ target: grammarPoints.id, set: update });

      for (const [i, e] of p.exercises.entries()) {
        const { prompt, key, scoringRule } = splitExercise(e);
        const ex = {
          id: `${p.id}.${e.id}`,
          grammarPointId: p.id,
          exerciseType: e.type,
          skill: "grammar",
          cefrLevel: p.level,
          difficulty: e.difficulty,
          prompt,
          answerKey: key,
          explanation: { zh: e.explanation_zh ?? null },
          errorCategory: e.error_category ?? p.default_error_category,
          scoringRule,
          sortOrder: i,
          contentVersion: GRAMMAR_SCHEMA_VERSION,
          archivedAt: null,
        };
        const { id: _eid, ...exUpdate } = ex;
        void _eid;
        await db.insert(exercises).values(ex).onConflictDoUpdate({ target: exercises.id, set: exUpdate });
      }
      rows += 1;
    }

    const exerciseIds = points.flatMap((p) => p.exercises.map((e) => `${p.id}.${e.id}`));
    await db
      .update(exercises)
      .set({ archivedAt: new Date() })
      .where(and(isNull(exercises.archivedAt), exerciseIds.length > 0 ? notInArray(exercises.id, exerciseIds) : undefined));
    await db
      .update(grammarPoints)
      .set({ archivedAt: new Date() })
      .where(
        and(
          isNull(grammarPoints.archivedAt),
          notInArray(
            grammarPoints.id,
            points.map((p) => p.id),
          ),
        ),
      );
    return { rows };
  },
};
