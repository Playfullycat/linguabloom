import { and, desc, eq, ne } from "drizzle-orm";

import type { DbExecutor } from "@/db/connection";
import { errorItems, learnerLessonProgress, lessons, userVocabulary, vocabularyEntries } from "@/db/schema";
import { getCurrentEstimates } from "@/modules/assessment/services/assessment";
import { CEFR_LEVELS, CEFR_LEVEL_LABELS, isCefrLevel, type CefrLevel } from "@/modules/curriculum/domain/cefr";
import { ERROR_CATEGORY_LABELS } from "@/modules/grammar/content";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { getMaterialForReader } from "@/modules/materials/services/materials";

import type { TutorContext, TutorMode } from "./prompts";

/**
 * The minimum learning context a tutor mode needs (spec §5.9: "只传递完成任务所需的最少上下文").
 * The language level is the lowest of the reading, vocabulary and grammar estimates,
 * so the AI never talks above the learner's weakest relevant skill.
 */
export async function buildTutorContext(db: DbExecutor, userId: string, mode: TutorMode, material?: { contentId: string; seq: number | null }): Promise<TutorContext> {
  const [{ profile }, estimates] = await Promise.all([getLearnerSettings(db, userId), getCurrentEstimates(db, userId)]);
  const relevant = estimates.filter((e) => ["reading", "vocabulary", "grammar"].includes(e.skill) && isCefrLevel(e.level));
  let level: CefrLevel = "a1";
  let levelBasis = "还没有技能估计";
  if (relevant.length > 0) {
    const lowest = relevant.reduce((a, b) => (CEFR_LEVELS.indexOf(a.level as CefrLevel) <= CEFR_LEVELS.indexOf(b.level as CefrLevel) ? a : b));
    level = lowest.level as CefrLevel;
    levelBasis = { reading: "阅读估计", vocabulary: "词汇估计", grammar: "语法估计" }[lowest.skill as "reading"] ?? "技能估计";
  }

  const needsWords = mode === "review" || mode === "ask_me" || mode === "practice";
  const recentWords = needsWords
    ? (
        await db
          .select({ text: vocabularyEntries.text })
          .from(userVocabulary)
          .innerJoin(vocabularyEntries, eq(vocabularyEntries.id, userVocabulary.entryId))
          .where(eq(userVocabulary.userId, userId))
          .orderBy(desc(userVocabulary.firstSeenAt))
          .limit(12)
      ).map((r) => r.text)
    : [];
  const recentLessons = needsWords
    ? (
        await db
          .select({ title: lessons.titleEn })
          .from(learnerLessonProgress)
          .innerJoin(lessons, eq(lessons.id, learnerLessonProgress.lessonId))
          .where(and(eq(learnerLessonProgress.userId, userId), eq(learnerLessonProgress.status, "completed")))
          .orderBy(desc(learnerLessonProgress.completedAt))
          .limit(3)
      ).map((r) => r.title)
    : [];
  const weakSpots =
    mode === "review"
      ? (
          await db
            .select({ title: errorItems.title, category: errorItems.category })
            .from(errorItems)
            .where(and(eq(errorItems.userId, userId), ne(errorItems.status, "resolved")))
            .orderBy(desc(errorItems.occurrenceCount))
            .limit(3)
        ).map((e) => `${e.title}（${ERROR_CATEGORY_LABELS[e.category as keyof typeof ERROR_CATEGORY_LABELS] ?? e.category}）`)
      : [];

  let materialCtx: TutorContext["material"] = null;
  if ((mode === "reading_coach" || mode === "listening_coach") && material) {
    const m = await getMaterialForReader(db, userId, material.contentId);
    // Up to 12 sentences around the one the learner is looking at.
    const focus = material.seq;
    const start = focus === null ? 0 : Math.max(0, focus - 5);
    const rows = m.segments.slice(start, start + 12);
    materialCtx = { title: m.titleEn, sentences: rows.map((s) => ({ n: s.sequence + 1, en: s.en })), focus: focus === null ? null : focus + 1 };
  }

  return {
    level: CEFR_LEVEL_LABELS[level],
    levelBasis,
    explanationLanguage: (["zh", "mixed", "en"].includes(profile.explanationLanguage) ? profile.explanationLanguage : "zh") as TutorContext["explanationLanguage"],
    goals: profile.learningGoals,
    recentWords,
    recentLessons,
    weakSpots,
    material: materialCtx,
  };
}

