import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import type { OnboardingData } from "@/components/onboarding/types";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { DIAGNOSTIC_SKILL_LABELS, type DiagnosticSkill } from "@/modules/assessment/content";
import { SELF_REPORTED_LEVELS, SELF_REPORT_LABELS } from "@/modules/assessment/domain/engine";
import { getActiveSession, getCurrentEstimates, getLatestCompletedSession } from "@/modules/assessment/services/assessment";
import { CEFR_LEVEL_LABELS, isCefrLevel } from "@/modules/curriculum/domain/cefr";
import {
  EXPLANATION_LANGUAGES,
  EXPLANATION_LANGUAGE_LABELS,
  LEARNING_GOALS,
  LEARNING_GOAL_LABELS,
  getLearnerSettings,
} from "@/modules/learner/services/profile";
import { SESSION_BLOCK_LABELS, SESSION_LENGTHS, getSessionTemplate, isSessionLength } from "@/modules/study-plan/domain/session-templates";
import { previewStartingPoint } from "@/modules/study-plan/services/plan";

export const metadata: Metadata = { title: "Getting started" };

const LANGUAGE_DETAILS: Record<(typeof EXPLANATION_LANGUAGES)[number], string> = {
  zh: "入门阶段推荐：讲解和反馈都用中文。",
  mixed: "讲解以中文为主，逐步加入简单英文。",
  en: "讲解尽量用简单英文，必要时才给中文。",
};

const LENGTH_DETAILS: Record<number, string> = {
  15: "到期复习 + 一小段输入",
  25: "到期复习 + 一节课（推荐）",
  40: "复习 + 一节课 + 开口练习",
  60: "复习 + 课程 + 听力 + 输出",
};

function describeTemplate(minutes: number) {
  if (!isSessionLength(minutes)) return "";
  return getSessionTemplate(minutes)
    .map((b) => `${SESSION_BLOCK_LABELS[b.kind].title} ${b.minutes} 分钟`)
    .join(" + ");
}

export default function OnboardingPage() {
  return (
    <>
      <PageHeader title="Getting started" titleZh="开始之前" description="几分钟了解你的情况，帮你安排合适的起点和节奏。" />
      <Suspense fallback={<LoadingSkeleton label="正在加载…" />}>
        <OnboardingLoader />
      </Suspense>
    </>
  );
}

async function OnboardingLoader() {
  const user = await requireOwner();
  const db = getDb();
  const { profile, preferences } = await getLearnerSettings(db, user.id, getEnv().DEFAULT_TIMEZONE);
  const [active, completed, estimates, start] = await Promise.all([
    getActiveSession(db, user.id),
    getLatestCompletedSession(db, user.id),
    getCurrentEstimates(db, user.id),
    previewStartingPoint(db, user.id),
  ]);

  const data: OnboardingData = {
    step: profile.onboardingStep,
    completed: profile.onboardingCompletedAt !== null,
    explanationLanguage: profile.explanationLanguage,
    learningGoals: profile.learningGoals,
    weeklyDays: preferences.weeklyDays,
    dailyMinutes: preferences.dailyMinutes,
    selfReportedLevel: profile.selfReportedLevel,
    diagnostic: active ? "in_progress" : completed ? "completed" : "none",
    options: {
      languages: EXPLANATION_LANGUAGES.map((value) => ({ value, label: EXPLANATION_LANGUAGE_LABELS[value], detail: LANGUAGE_DETAILS[value] })),
      goals: LEARNING_GOALS.map((value) => ({ value, label: LEARNING_GOAL_LABELS[value] })),
      selfReports: SELF_REPORTED_LEVELS.map((value) => ({ value, label: SELF_REPORT_LABELS[value] })),
      lengths: SESSION_LENGTHS.map((value) => ({ value, detail: LENGTH_DETAILS[value]! })),
    },
    summary: {
      template: describeTemplate(preferences.dailyMinutes),
      start: start.nextLesson ? `${start.nextLesson.levelLabel} · ${start.nextLesson.titleEn}（${start.nextLesson.titleZh}）` : null,
      startReason: start.startingLevelLabel
        ? `根据诊断的初步估计，从 ${start.startingLevelLabel} 开始。前面的单元也随时可以回去学。`
        : estimates.length > 0
          ? "接着你的学习进度继续。"
          : "从第一课开始；做完诊断后起点会更合适。",
      estimates: estimates
        .filter((e): e is typeof e & { skill: DiagnosticSkill } => e.skill in DIAGNOSTIC_SKILL_LABELS)
        .map((e) => ({
          skill: e.skill,
          skillLabel: DIAGNOSTIC_SKILL_LABELS[e.skill],
          levelLabel: isCefrLevel(e.level) ? CEFR_LEVEL_LABELS[e.level] : e.level,
          evidenceCount: e.evidenceCount,
        })),
    },
  };

  // Keyed by the saved step: the router keeps visited pages alive, so a step saved elsewhere
  // (e.g. finishing the diagnostic) must reset the wizard instead of showing stale state.
  return <OnboardingWizard key={`${data.step}:${data.completed}`} data={data} />;
}
