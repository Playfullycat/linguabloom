import { eq } from "drizzle-orm";
import { z } from "zod";

import type { DbExecutor } from "@/db/connection";
import { learnerProfiles, studyPreferences } from "@/db/schema";
import { SELF_REPORTED_LEVELS } from "@/modules/assessment/domain/engine";
import { isSessionLength } from "@/modules/study-plan/domain/session-templates";

/**
 * Learner profile and study preferences (spec §4.1, §8.1). Rows are created
 * lazily with sensible defaults, so every page can rely on them existing.
 */

export const LEARNING_GOALS = ["general", "conversation", "work", "travel", "exam"] as const;
export const LEARNING_GOAL_LABELS: Record<(typeof LEARNING_GOALS)[number], string> = {
  general: "打好通用英语基础",
  conversation: "日常交流",
  work: "工作中使用英语",
  travel: "旅行",
  exam: "以后准备考试（如 PTE）",
};

export const EXPLANATION_LANGUAGES = ["zh", "mixed", "en"] as const;
export const EXPLANATION_LANGUAGE_LABELS: Record<(typeof EXPLANATION_LANGUAGES)[number], string> = {
  zh: "中文讲解",
  mixed: "中英混合",
  en: "尽量用英文",
};

/** Onboarding steps, in order. The stored step is where the learner resumes. */
export const ONBOARDING_STEPS = ["welcome", "language", "goals", "schedule", "self_report", "diagnostic", "summary"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type LearnerSettings = {
  profile: typeof learnerProfiles.$inferSelect;
  preferences: typeof studyPreferences.$inferSelect;
};

function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function getLearnerSettings(db: DbExecutor, userId: string, defaultTimeZone = "Asia/Shanghai"): Promise<LearnerSettings> {
  let [profile] = await db.select().from(learnerProfiles).where(eq(learnerProfiles.userId, userId));
  if (!profile) {
    await db
      .insert(learnerProfiles)
      .values({ userId, timezone: isValidTimeZone(defaultTimeZone) ? defaultTimeZone : "Asia/Shanghai" })
      .onConflictDoNothing();
    [profile] = await db.select().from(learnerProfiles).where(eq(learnerProfiles.userId, userId));
  }
  let [preferences] = await db.select().from(studyPreferences).where(eq(studyPreferences.userId, userId));
  if (!preferences) {
    await db.insert(studyPreferences).values({ userId }).onConflictDoNothing();
    [preferences] = await db.select().from(studyPreferences).where(eq(studyPreferences.userId, userId));
  }
  return { profile: profile!, preferences: preferences! };
}

export const profileSchema = z.object({
  explanationLanguage: z.enum(EXPLANATION_LANGUAGES),
  learningGoals: z.array(z.enum(LEARNING_GOALS)).max(LEARNING_GOALS.length),
  selfReportedLevel: z.enum(SELF_REPORTED_LEVELS).nullable(),
  timezone: z.string().min(1).max(64).refine(isValidTimeZone, "未知的时区"),
  profileNotes: z.string().trim().max(1000).nullable(),
});

export const preferencesSchema = z.object({
  dailyMinutes: z.number().int().refine(isSessionLength, "时长只能是 15、25、40 或 60 分钟"),
  weeklyDays: z.number().int().min(1).max(7),
  newItemsLimit: z.number().int().min(0).max(100),
  showWeeklyStreak: z.boolean(),
});

export async function updateProfile(db: DbExecutor, userId: string, input: Partial<z.infer<typeof profileSchema>>) {
  await getLearnerSettings(db, userId);
  const data = profileSchema.partial().parse(input);
  if (data.learningGoals) data.learningGoals = [...new Set(data.learningGoals)];
  await db.update(learnerProfiles).set(data).where(eq(learnerProfiles.userId, userId));
}

export async function updatePreferences(db: DbExecutor, userId: string, input: Partial<z.infer<typeof preferencesSchema>>) {
  await getLearnerSettings(db, userId);
  const data = preferencesSchema.partial().parse(input);
  await db.update(studyPreferences).set(data).where(eq(studyPreferences.userId, userId));
}

/** Save the resume point for onboarding. */
export async function setOnboardingStep(db: DbExecutor, userId: string, step: OnboardingStep) {
  await getLearnerSettings(db, userId);
  await db.update(learnerProfiles).set({ onboardingStep: step }).where(eq(learnerProfiles.userId, userId));
}

/** Finish (or skip) onboarding; the learner can revisit it from Settings. */
export async function completeOnboarding(db: DbExecutor, userId: string, now = new Date()) {
  await getLearnerSettings(db, userId);
  await db
    .update(learnerProfiles)
    .set({ onboardingStep: "summary", onboardingCompletedAt: now })
    .where(eq(learnerProfiles.userId, userId));
}
