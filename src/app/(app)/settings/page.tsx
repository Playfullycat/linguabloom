import { Bot, DatabaseBackup, Palette, Target, UserRound, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { ThemePreferenceControl } from "@/components/layout/theme-controls";
import { PageHeader } from "@/components/layout/page-header";
import { PhaseBadge } from "@/components/layout/planned-feature";
import { AccountSettings, AccountSettingsSkeleton } from "@/components/settings/account-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileForm, StudyPlanForm } from "@/components/settings/learner-settings-form";
import { Button } from "@/components/ui/button";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import type { Phase } from "@/lib/config/navigation";
import {
  EXPLANATION_LANGUAGES,
  EXPLANATION_LANGUAGE_LABELS,
  LEARNING_GOALS,
  LEARNING_GOAL_LABELS,
  getLearnerSettings,
} from "@/modules/learner/services/profile";
import { SESSION_LENGTHS } from "@/modules/study-plan/domain/session-templates";

export const metadata: Metadata = { title: "Settings" };

const plannedSections: { icon: LucideIcon; title: string; titleEn: string; description: string; phase: Phase }[] = [
  {
    icon: Bot,
    title: "AI 服务",
    titleEn: "AI Providers",
    description: "查看 AI 配置状态、用量和预算提醒。密钥只在服务器环境变量中配置。",
    phase: 3,
  },
  {
    icon: DatabaseBackup,
    title: "数据与备份",
    titleEn: "Data & Backup",
    description: "导出学习数据、删除录音和会话记录、备份与恢复说明。",
    phase: 1,
  },
];

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <>
      <PageHeader title="Settings" titleZh="设置" description="外观、学习计划、AI 服务和数据。" />

      <div className="flex flex-col gap-4">
        <Suspense fallback={<AccountSettingsSkeleton />}>
          <AccountSettings searchParams={searchParams} />
        </Suspense>

        <Suspense fallback={<LoadingSkeleton label="正在加载学习设置…" />}>
          <LearnerSettings />
        </Suspense>

        <Card>
          <CardHeader className="flex-row items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-ink">
              <Palette className="size-5" aria-hidden="true" />
            </span>
            <div className="flex flex-col gap-1">
              <CardTitle>
                外观 <span lang="en" className="ml-1 text-sm font-normal text-muted">Appearance</span>
              </CardTitle>
              <CardDescription>选择界面主题。“跟随系统”会随操作系统的深色设置自动切换。</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ThemePreferenceControl />
            <p className="mt-3 text-xs text-muted">保存在当前浏览器中；学习偏好上线（Phase 1）后会同步到你的账户。</p>
          </CardContent>
        </Card>

        {plannedSections.map((section) => {
          const Icon = section.icon;
          return (
            <Card key={section.titleEn}>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-soft text-muted">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="flex flex-col gap-1">
                    <h2 className="text-base font-semibold text-ink">
                      {section.title}
                      <span lang="en" className="ml-2 text-sm font-normal text-muted">
                        {section.titleEn}
                      </span>
                    </h2>
                    <p className="text-sm text-muted">{section.description}</p>
                  </div>
                </div>
                <PhaseBadge phase={section.phase} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function SettingsSection({ icon: Icon, title, titleEn, description, children }: { icon: LucideIcon; title: string; titleEn: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-ink">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1">
          <CardTitle>
            {title} <span lang="en" className="ml-1 text-sm font-normal text-muted">{titleEn}</span>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

async function LearnerSettings() {
  const user = await requireOwner();
  const { profile, preferences } = await getLearnerSettings(getDb(), user.id, getEnv().DEFAULT_TIMEZONE);
  const zones = Intl.supportedValuesOf("timeZone");
  const timeZones = zones.includes(profile.timezone) ? zones : [profile.timezone, ...zones];
  return (
    <>
      <SettingsSection icon={UserRound} title="学习者档案" titleEn="Profile" description="讲解语言、学习目标和时区。母语默认为中文。">
        <ProfileForm
          initial={{
            explanationLanguage: profile.explanationLanguage,
            learningGoals: profile.learningGoals,
            timezone: profile.timezone,
            profileNotes: profile.profileNotes ?? "",
          }}
          languages={EXPLANATION_LANGUAGES.map((value) => ({ value, label: EXPLANATION_LANGUAGE_LABELS[value] }))}
          goals={LEARNING_GOALS.map((value) => ({ value, label: LEARNING_GOAL_LABELS[value] }))}
          timeZones={timeZones}
        />
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          <Button asChild variant="soft" size="sm">
            <Link href="/onboarding">重新走一遍引导</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/assessment">水平诊断</Link>
          </Button>
        </div>
      </SettingsSection>
      <SettingsSection icon={Target} title="学习计划" titleEn="Study Plan" description="每周学习天数、每次时长和每天的新卡上限。">
        <StudyPlanForm
          initial={{
            dailyMinutes: preferences.dailyMinutes,
            weeklyDays: preferences.weeklyDays,
            newItemsLimit: preferences.newItemsLimit,
            showWeeklyStreak: preferences.showWeeklyStreak,
          }}
          lengths={SESSION_LENGTHS}
        />
      </SettingsSection>
    </>
  );
}
