import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import { loadContent } from "../../modules/curriculum/content/load";
import { CONTENT_SCHEMA_VERSION, isAssessedStepType } from "../../modules/curriculum/content/schema";
import type { DbExecutor } from "../connection";
import { courses, lessons, lessonSteps, units } from "../schema";
import type { Seed } from "./types";

/**
 * Loads the course catalog and every authored unit (lessons + steps).
 * Idempotent: re-running updates content in place. Lessons/steps removed from
 * the files are archived (not deleted) so learner history stays intact.
 */
export const curriculumSeed: Seed = {
  name: "curriculum",
  async run(db: DbExecutor) {
    const { catalog, units: authored } = loadContent();
    const { course } = catalog;
    let rows = 0;

    await db
      .insert(courses)
      .values({
        id: course.id,
        titleEn: course.title_en,
        titleZh: course.title_zh,
        summaryZh: course.summary_zh,
        sourceType: course.source_type,
        contentSchemaVersion: CONTENT_SCHEMA_VERSION,
      })
      .onConflictDoUpdate({
        target: courses.id,
        set: {
          titleEn: sql`excluded.title_en`,
          titleZh: sql`excluded.title_zh`,
          summaryZh: sql`excluded.summary_zh`,
          sourceType: sql`excluded.source_type`,
          contentSchemaVersion: sql`excluded.content_schema_version`,
        },
      });
    rows += 1;

    for (const entry of catalog.units) {
      const file = authored.get(entry.id);
      const unitRow = {
        id: entry.id,
        courseId: course.id,
        level: entry.level,
        sortOrder: entry.order,
        titleEn: entry.title_en,
        titleZh: entry.title_zh,
        summaryZh: file?.unit.summary_zh ?? entry.summary_zh,
        status: file?.unit.status ?? "planned",
        reviewStatus: file?.review_status ?? "unreviewed",
        sourceType: file?.source_type ?? course.source_type,
        content: file
          ? { can_do: file.unit.can_do, grammar_points: file.unit.grammar_points, vocabulary: file.unit.vocabulary }
          : null,
        contentSchemaVersion: CONTENT_SCHEMA_VERSION,
      };
      await db
        .insert(units)
        .values(unitRow)
        .onConflictDoUpdate({
          target: units.id,
          set: {
            level: sql`excluded.level`,
            sortOrder: sql`excluded.sort_order`,
            titleEn: sql`excluded.title_en`,
            titleZh: sql`excluded.title_zh`,
            summaryZh: sql`excluded.summary_zh`,
            status: sql`excluded.status`,
            reviewStatus: sql`excluded.review_status`,
            sourceType: sql`excluded.source_type`,
            content: sql`excluded.content`,
            contentSchemaVersion: sql`excluded.content_schema_version`,
          },
        });
      rows += 1;

      const fileLessons = file?.unit.lessons ?? [];
      const lessonIds = fileLessons.map((l) => l.id);

      // Archive lessons that are no longer in the file (keeps learner history).
      await db
        .update(lessons)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(lessons.unitId, entry.id),
            isNull(lessons.archivedAt),
            lessonIds.length > 0 ? notInArray(lessons.id, lessonIds) : sql`true`,
          ),
        );

      for (const lesson of fileLessons) {
        await db
          .insert(lessons)
          .values({
            id: lesson.id,
            unitId: entry.id,
            sortOrder: lesson.order,
            kind: lesson.kind,
            titleEn: lesson.title_en,
            titleZh: lesson.title_zh,
            estimatedMinutes: lesson.estimated_minutes,
            objectives: lesson.objectives,
            canDoIds: lesson.can_do_ids,
            archivedAt: null,
          })
          .onConflictDoUpdate({
            target: lessons.id,
            set: {
              unitId: sql`excluded.unit_id`,
              sortOrder: sql`excluded.sort_order`,
              kind: sql`excluded.kind`,
              titleEn: sql`excluded.title_en`,
              titleZh: sql`excluded.title_zh`,
              estimatedMinutes: sql`excluded.estimated_minutes`,
              objectives: sql`excluded.objectives`,
              canDoIds: sql`excluded.can_do_ids`,
              archivedAt: sql`null`,
            },
          });
        rows += 1;

        const stepIds = lesson.steps.map((s) => `${lesson.id}.${s.id}`);
        await db
          .update(lessonSteps)
          .set({ archivedAt: new Date() })
          .where(and(eq(lessonSteps.lessonId, lesson.id), isNull(lessonSteps.archivedAt), notInArray(lessonSteps.id, stepIds)));

        for (const [index, step] of lesson.steps.entries()) {
          await db
            .insert(lessonSteps)
            .values({
              id: `${lesson.id}.${step.id}`,
              lessonId: lesson.id,
              stepKey: step.id,
              sortOrder: index + 1,
              stepType: step.type,
              role: step.role,
              skill: step.skill,
              assessed: isAssessedStepType(step.type),
              content: step,
              archivedAt: null,
            })
            .onConflictDoUpdate({
              target: lessonSteps.id,
              set: {
                sortOrder: sql`excluded.sort_order`,
                stepType: sql`excluded.step_type`,
                role: sql`excluded.role`,
                skill: sql`excluded.skill`,
                assessed: sql`excluded.assessed`,
                content: sql`excluded.content`,
                archivedAt: sql`null`,
              },
            });
          rows += 1;
        }
      }
    }

    // Units removed from the catalog entirely become archived.
    const catalogIds = catalog.units.map((u) => u.id);
    await db
      .update(units)
      .set({ status: "archived" })
      .where(and(eq(units.courseId, course.id), notInArray(units.id, catalogIds), inArray(units.status, ["planned", "draft", "published"])));

    return { rows };
  },
};
