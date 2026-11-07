"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getLearnerSettings, setOnboardingStep } from "@/modules/learner/services/profile";
import { regenerateTodayPlan } from "@/modules/study-plan/services/plan";

import { DIAGNOSTIC_SKILLS } from "./content";
import {
  AssessmentItemRejectedError,
  AssessmentSessionNotFoundError,
  answerAssessmentItem,
  completeAssessment,
  getAssessmentState,
  saveWritingSample,
  skipAssessmentSkill,
  startOrResumeAssessment,
  type AnswerItemResult,
  type AssessmentState,
} from "./services/assessment";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const NOT_FOUND = "找不到这次诊断，请刷新页面。";

/** Start a diagnostic (or resume the open one). Uses the self-report saved in the profile. */
export async function startAssessmentAction(): Promise<ActionResult<{ sessionId: string }>> {
  const user = await requireOwner();
  const db = getDb();
  const { profile } = await getLearnerSettings(db, user.id);
  const sessionId = await startOrResumeAssessment(db, user.id, profile.selfReportedLevel);
  return { ok: true, data: { sessionId } };
}

const answerSchema = z.object({
  sessionId: z.uuid(),
  itemId: z.string().min(1).max(40),
  choice: z.number().int().min(-1).max(10).optional(),
  text: z.string().max(200).optional(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
});

/** Score one answer on the server. "I don't know" is sent as an empty answer. */
export async function answerAssessmentAction(input: z.input<typeof answerSchema>): Promise<ActionResult<AnswerItemResult>> {
  const user = await requireOwner();
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "提交的数据格式不正确。" };
  try {
    return { ok: true, data: await answerAssessmentItem(getDb(), user.id, parsed.data) };
  } catch (error) {
    if (error instanceof AssessmentSessionNotFoundError) return { ok: false, error: NOT_FOUND };
    if (error instanceof AssessmentItemRejectedError) return { ok: false, error: "这道题已经过去了，请刷新页面继续。" };
    throw error;
  }
}

const skipSchema = z.object({ sessionId: z.uuid(), skill: z.enum(DIAGNOSTIC_SKILLS) });

export async function skipAssessmentSkillAction(input: z.input<typeof skipSchema>): Promise<ActionResult<AssessmentState>> {
  const user = await requireOwner();
  const parsed = skipSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "提交的数据格式不正确。" };
  try {
    const db = getDb();
    await skipAssessmentSkill(db, user.id, parsed.data.sessionId, parsed.data.skill);
    return { ok: true, data: await getAssessmentState(db, user.id, parsed.data.sessionId) };
  } catch (error) {
    if (error instanceof AssessmentSessionNotFoundError) return { ok: false, error: NOT_FOUND };
    throw error;
  }
}

const finishSchema = z.object({ sessionId: z.uuid(), writingSample: z.string().max(2000).optional() });

/** Save the optional writing sample and write the preliminary estimates. */
export async function completeAssessmentAction(input: z.input<typeof finishSchema>): Promise<ActionResult<null>> {
  const user = await requireOwner();
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "写作样本最多 2000 个字符。" };
  try {
    const db = getDb();
    if (parsed.data.writingSample !== undefined) await saveWritingSample(db, user.id, parsed.data.sessionId, parsed.data.writingSample);
    await completeAssessment(db, user.id, parsed.data.sessionId);
    // Taken during onboarding: the next stop there is the first-week summary.
    const { profile } = await getLearnerSettings(db, user.id);
    if (!profile.onboardingCompletedAt) await setOnboardingStep(db, user.id, "summary");
    // The starting point may have changed.
    await regenerateTodayPlan(db, user.id, {});
    revalidatePath("/today");
    revalidatePath("/progress");
    return { ok: true, data: null };
  } catch (error) {
    if (error instanceof AssessmentSessionNotFoundError) return { ok: false, error: NOT_FOUND };
    throw error;
  }
}
