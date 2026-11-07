"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";

import { isSessionLength } from "@/modules/study-plan/domain/session-templates";
import { regenerateTodayPlan } from "@/modules/study-plan/services/plan";

import {
  ONBOARDING_STEPS,
  completeOnboarding,
  getLearnerSettings,
  preferencesSchema,
  profileSchema,
  setOnboardingStep,
  updatePreferences,
  updateProfile,
} from "./services/profile";

export type SaveResult = { ok: true } | { ok: false; error: string };

const onboardingSchema = z.object({
  /** Step to resume at next time. */
  step: z.enum(ONBOARDING_STEPS),
  profile: profileSchema.partial().optional(),
  preferences: preferencesSchema.partial().optional(),
});

/** Save one onboarding step's answers and the resume point. */
export async function saveOnboardingAction(input: z.input<typeof onboardingSchema>): Promise<SaveResult> {
  const user = await requireOwner();
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "提交的内容格式不正确。" };
  const db = getDb();
  if (parsed.data.profile) await updateProfile(db, user.id, parsed.data.profile);
  if (parsed.data.preferences) await updatePreferences(db, user.id, parsed.data.preferences);
  await setOnboardingStep(db, user.id, parsed.data.step);
  return { ok: true };
}

/** Finish (or skip) onboarding, then rebuild today's plan with the chosen length. */
export async function completeOnboardingAction(): Promise<SaveResult> {
  const user = await requireOwner();
  const db = getDb();
  await completeOnboarding(db, user.id);
  const { preferences } = await getLearnerSettings(db, user.id);
  await regenerateTodayPlan(db, user.id, { sessionMinutes: isSessionLength(preferences.dailyMinutes) ? preferences.dailyMinutes : undefined });
  revalidatePath("/today");
  return { ok: true };
}

const settingsSchema = z.object({
  profile: profileSchema.partial().optional(),
  preferences: preferencesSchema.partial().optional(),
});

/** Settings → Profile / Study Plan. */
export async function updateLearnerSettingsAction(input: z.input<typeof settingsSchema>): Promise<SaveResult> {
  const user = await requireOwner();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "提交的内容格式不正确。" };
  }
  const db = getDb();
  if (parsed.data.profile) await updateProfile(db, user.id, parsed.data.profile);
  if (parsed.data.preferences) await updatePreferences(db, user.id, parsed.data.preferences);
  revalidatePath("/settings");
  revalidatePath("/today");
  return { ok: true };
}
