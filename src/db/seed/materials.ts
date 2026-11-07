import { and, eq, isNull, notInArray, sql } from "drizzle-orm";

import { MATERIAL_SCHEMA_VERSION, loadMaterials } from "../../modules/materials/content";
import { containsPhrase, difficultyOf } from "../../modules/materials/domain/text";
import type { DbExecutor } from "../connection";
import { learningContents, transcriptSegments, vocabularyEntries } from "../schema";
import type { Seed } from "./types";

/**
 * Loads the built-in reading and listening materials, their sentences and
 * their glossary words (as vocabulary entries, so they can be collected into
 * review). Materials removed from the files are archived, not deleted.
 */
export const materialsSeed: Seed = {
  name: "materials",
  async run(db: DbExecutor) {
    const materials = loadMaterials();
    let rows = 0;
    for (const m of materials) {
      const values = {
        id: m.id,
        type: m.type,
        titleEn: m.title_en,
        titleZh: m.title_zh,
        summaryZh: m.summary_zh,
        cefrLevel: m.level,
        topic: m.topic,
        difficultyMetadata: difficultyOf(
          m.segments.map((s) => s.en),
          m.glossary,
        ),
        sourceType: m.file.source_type,
        sourceUrl: null,
        copyrightStatus: m.file.copyright_status,
        reviewStatus: m.file.review_status,
        status: "published",
        ownerUserId: null,
        content: { glossary: m.glossary, questions: m.questions },
        contentVersion: MATERIAL_SCHEMA_VERSION,
        archivedAt: null,
      };
      const { id: _id, ...update } = values;
      void _id;
      await db.insert(learningContents).values(values).onConflictDoUpdate({ target: learningContents.id, set: update });

      // Sentences are content, not learner data: replace them wholesale.
      await db.delete(transcriptSegments).where(eq(transcriptSegments.contentId, m.id));
      await db.insert(transcriptSegments).values(
        m.segments.map((s, i) => ({ contentId: m.id, sequence: i, speaker: s.speaker ?? null, textEn: s.en, textZh: s.zh })),
      );

      for (const g of m.glossary) {
        const forms = [g.text, ...(g.forms ?? [])];
        const example = m.segments.find((s) => forms.some((f) => containsPhrase(s.en, f))) ?? { en: m.title_en, zh: m.title_zh };
        await db
          .insert(vocabularyEntries)
          .values({
            id: `${m.id}.${g.key}`,
            unitId: null,
            key: g.key,
            text: g.text,
            partOfSpeech: g.pos,
            ipa: g.ipa ?? null,
            definitionZh: g.zh,
            exampleEn: example.en,
            exampleZh: example.zh,
            cefrLevel: m.level,
            sourceType: m.file.source_type,
          })
          .onConflictDoUpdate({
            target: vocabularyEntries.id,
            set: {
              text: sql`excluded.text`,
              partOfSpeech: sql`excluded.part_of_speech`,
              ipa: sql`excluded.ipa`,
              definitionZh: sql`excluded.definition_zh`,
              exampleEn: sql`excluded.example_en`,
              exampleZh: sql`excluded.example_zh`,
              cefrLevel: sql`excluded.cefr_level`,
              sourceType: sql`excluded.source_type`,
            },
          });
      }
      rows += 1;
    }

    await db
      .update(learningContents)
      .set({ status: "archived", archivedAt: new Date() })
      .where(
        and(
          isNull(learningContents.ownerUserId),
          isNull(learningContents.archivedAt),
          notInArray(
            learningContents.id,
            materials.map((m) => m.id),
          ),
        ),
      );
    return { rows };
  },
};
