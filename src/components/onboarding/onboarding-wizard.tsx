"use client";

import { ArrowLeft, ArrowRight, Check, ClipboardCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form-message";
import { ProgressBar } from "@/components/ui/progress-bar";
import { cn } from "@/lib/utils";
import { completeOnboardingAction, saveOnboardingAction } from "@/modules/learner/actions";

import type { OnboardingData } from "./types";

const STEPS = ["welcome", "language", "goals", "schedule", "self_report", "diagnostic", "summary"] as const;
type Step = (typeof STEPS)[number];

const STEP_TITLES: Record<Step, string> = {
  welcome: "欢迎",
  language: "讲解语言",
  goals: "学习目标",
  schedule: "学习节奏",
  self_report: "现在的水平",
  diagnostic: "水平诊断",
  summary: "第一周计划",
};

function OptionCard({
  type,
  name,
  checked,
  onChange,
  title,
  detail,
}: {
  type: "radio" | "checkbox";
  name: string;
  checked: boolean;
  onChange: () => void;
  title: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex min-h-12 cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
        checked ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-surface-soft",
      )}
    >
      <input type={type} name={name} className="sr-only" checked={checked} onChange={onChange} />
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center border-2",
          type === "radio" ? "rounded-full" : "rounded-md",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-border-strong",
        )}
      >
        {checked ? type === "radio" ? <span className="size-2 rounded-full bg-primary-foreground" /> : <Check className="size-3.5" /> : null}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[0.9375rem] font-medium text-ink">{title}</span>
        {detail ? <span className="text-sm text-muted">{detail}</span> : null}
      </span>
    </label>
  );
}

export function OnboardingWizard({ data }: { data: OnboardingData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const initial = (STEPS as readonly string[]).includes(data.step) ? (data.step as Step) : "welcome";
  const [step, setStep] = useState<Step>(data.completed ? "summary" : initial);

  const [language, setLanguage] = useState(data.explanationLanguage);
  const [goals, setGoals] = useState<string[]>(data.learningGoals);
  const [weeklyDays, setWeeklyDays] = useState(data.weeklyDays);
  const [dailyMinutes, setDailyMinutes] = useState(data.dailyMinutes);
  const [selfReport, setSelfReport] = useState<string | null>(data.selfReportedLevel);

  const index = STEPS.indexOf(step);

  const go = (next: Step, payload: Parameters<typeof saveOnboardingAction>[0] = { step: next }) => {
    setError(null);
    startTransition(async () => {
      const result = await saveOnboardingAction({ ...payload, step: next });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStep(next);
      if (next === "summary") router.refresh();
      // Move focus to the new step heading for keyboard and screen-reader users.
      requestAnimationFrame(() => document.getElementById("onboarding-step-title")?.focus());
    });
  };

  const finish = (href: string) => {
    setError(null);
    startTransition(async () => {
      const result = await completeOnboardingAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(href);
    });
  };

  const back = index > 0 ? STEPS[index - 1]! : null;
  const nav = (next: ReactNode) => (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      {back && step !== "summary" ? (
        <Button variant="ghost" onClick={() => setStep(back)} disabled={pending}>
          <ArrowLeft aria-hidden="true" />
          上一步
        </Button>
      ) : (
        <span />
      )}
      {next}
    </div>
  );
  const nextButton = (onClick: () => void, label = "下一步", disabled = false) => (
    <Button onClick={onClick} disabled={pending || disabled}>
      {label}
      <ArrowRight aria-hidden="true" />
    </Button>
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            第 {index + 1} / {STEPS.length} 步 · {STEP_TITLES[step]}
          </span>
          {step !== "summary" ? (
            <button
              type="button"
              className="rounded text-sm text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => finish("/today")}
              disabled={pending}
            >
              跳过引导
            </button>
          ) : null}
        </div>
        <ProgressBar value={(index + 1) / STEPS.length} label="引导进度" />
      </div>

      <Card>
        <CardContent className="pt-6">
          {step === "welcome" ? (
            <section aria-labelledby="onboarding-step-title">
              <h2 id="onboarding-step-title" tabIndex={-1} className="text-xl font-semibold text-ink outline-none">
                你好，欢迎来到 LinguaBloom
              </h2>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
                接下来用几分钟了解你的情况：用什么语言讲解、为什么学英语、每周能学多久，以及一个可以随时暂停或跳过的水平诊断。
              </p>
              <ul className="mt-4 flex flex-col gap-2 text-sm text-ink">
                <li>· 所有选择以后都能在“设置”里修改。</li>
                <li>· 中途离开也没关系，下次会从这一步继续。</li>
                <li>· 诊断结果只是初步估计，会随着你的练习记录不断更新。</li>
              </ul>
              {nav(nextButton(() => go("language"), "开始"))}
            </section>
          ) : null}

          {step === "language" ? (
            <fieldset>
              <legend id="onboarding-step-title" tabIndex={-1} className="text-xl font-semibold text-ink outline-none">
                讲解用什么语言？
              </legend>
              <p className="mt-2 text-sm text-muted">英文例句和练习始终是英文；这里选的是讲解、提示和反馈的语言。</p>
              <div className="mt-4 flex flex-col gap-2">
                {data.options.languages.map((o) => (
                  <OptionCard key={o.value} type="radio" name="language" checked={language === o.value} onChange={() => setLanguage(o.value)} title={o.label} detail={o.detail} />
                ))}
              </div>
              {nav(nextButton(() => go("goals", { step: "goals", profile: { explanationLanguage: language as never } })))}
            </fieldset>
          ) : null}

          {step === "goals" ? (
            <fieldset>
              <legend id="onboarding-step-title" tabIndex={-1} className="text-xl font-semibold text-ink outline-none">
                你为什么学英语？
              </legend>
              <p className="mt-2 text-sm text-muted">可以多选，也可以都不选。先打好通用基础，考试专项（PTE）放在后面。</p>
              <div className="mt-4 flex flex-col gap-2">
                {data.options.goals.map((o) => (
                  <OptionCard
                    key={o.value}
                    type="checkbox"
                    name="goals"
                    checked={goals.includes(o.value)}
                    onChange={() => setGoals((g) => (g.includes(o.value) ? g.filter((x) => x !== o.value) : [...g, o.value]))}
                    title={o.label}
                  />
                ))}
              </div>
              {nav(nextButton(() => go("schedule", { step: "schedule", profile: { learningGoals: goals as never } })))}
            </fieldset>
          ) : null}

          {step === "schedule" ? (
            <section aria-labelledby="onboarding-step-title">
              <h2 id="onboarding-step-title" tabIndex={-1} className="text-xl font-semibold text-ink outline-none">
                每周学几天，每次多久？
              </h2>
              <p className="mt-2 text-sm text-muted">少而稳定比偶尔一次学很久更有效。每天打开时还可以临时换成别的时长。</p>
              <fieldset className="mt-5">
                <legend className="text-sm font-medium text-ink">每周学习天数</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <label
                      key={d}
                      className={cn(
                        "grid size-11 cursor-pointer place-items-center rounded-xl border text-[0.9375rem] font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                        weeklyDays === d ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-surface text-ink hover:bg-surface-soft",
                      )}
                    >
                      <input type="radio" name="weeklyDays" className="sr-only" checked={weeklyDays === d} onChange={() => setWeeklyDays(d)} />
                      <span aria-hidden="true">{d}</span>
                      <span className="sr-only">每周 {d} 天</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="mt-5">
                <legend className="text-sm font-medium text-ink">每次学习时长</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {data.options.lengths.map((o) => (
                    <OptionCard
                      key={o.value}
                      type="radio"
                      name="dailyMinutes"
                      checked={dailyMinutes === o.value}
                      onChange={() => setDailyMinutes(o.value)}
                      title={`${o.value} 分钟`}
                      detail={o.detail}
                    />
                  ))}
                </div>
              </fieldset>
              {nav(nextButton(() => go("self_report", { step: "self_report", preferences: { weeklyDays, dailyMinutes } })))}
            </section>
          ) : null}

          {step === "self_report" ? (
            <fieldset>
              <legend id="onboarding-step-title" tabIndex={-1} className="text-xl font-semibold text-ink outline-none">
                你觉得自己现在的英语怎么样？
              </legend>
              <p className="mt-2 text-sm text-muted">这只决定诊断从哪道题开始，不会直接当成你的水平。</p>
              <div className="mt-4 flex flex-col gap-2">
                {data.options.selfReports.map((o) => (
                  <OptionCard key={o.value} type="radio" name="selfReport" checked={selfReport === o.value} onChange={() => setSelfReport(o.value)} title={o.label} />
                ))}
              </div>
              {nav(nextButton(() => go("diagnostic", { step: "diagnostic", profile: { selfReportedLevel: selfReport as never } }), "下一步", selfReport === null))}
            </fieldset>
          ) : null}

          {step === "diagnostic" ? (
            <section aria-labelledby="onboarding-step-title">
              <h2 id="onboarding-step-title" tabIndex={-1} className="flex items-center gap-2 text-xl font-semibold text-ink outline-none">
                <ClipboardCheck className="size-5 text-primary-ink" aria-hidden="true" />
                做一个简短的水平诊断
              </h2>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
                词汇、语法、阅读、听力四部分，最多 24 题、约 12–18 分钟，可以估计到 C2。题目会根据你的回答变难或变简单。
                不会的题可以直接点“不会”，任何一部分都能跳过，中途离开下次可以继续。
              </p>
              {data.diagnostic === "completed" ? (
                <FormMessage tone="success" className="mt-4">
                  你已经完成过诊断。可以直接看第一周计划，也可以重新诊断一次。
                </FormMessage>
              ) : data.diagnostic === "in_progress" ? (
                <FormMessage tone="success" className="mt-4">
                  上次的诊断还没做完，可以接着做。
                </FormMessage>
              ) : null}
              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild>
                  <Link href="/assessment?from=onboarding">
                    {data.diagnostic === "in_progress" ? "继续诊断" : data.diagnostic === "completed" ? "重新诊断" : "开始诊断"}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <Button variant="outline" onClick={() => go("summary")} disabled={pending}>
                  {data.diagnostic === "completed" ? "查看第一周计划" : "先跳过，从头开始学"}
                </Button>
              </div>
              {nav(null)}
            </section>
          ) : null}

          {step === "summary" ? (
            <section aria-labelledby="onboarding-step-title">
              <h2 id="onboarding-step-title" tabIndex={-1} className="flex items-center gap-2 text-xl font-semibold text-ink outline-none">
                <Sparkles className="size-5 text-primary-ink" aria-hidden="true" />
                你的第一周
              </h2>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-2xl bg-surface-soft p-4">
                  <dt className="text-muted">节奏</dt>
                  <dd className="mt-1 font-medium text-ink">
                    每周 {data.weeklyDays} 天，每次 {data.dailyMinutes} 分钟
                  </dd>
                  <dd className="mt-1 text-muted">{data.summary.template}</dd>
                </div>
                <div className="rounded-2xl bg-surface-soft p-4">
                  <dt className="text-muted">起点</dt>
                  <dd className="mt-1 font-medium text-ink">{data.summary.start ?? "暂时没有可学的课程"}</dd>
                  <dd className="mt-1 text-muted">{data.summary.startReason}</dd>
                </div>
              </dl>
              {data.summary.estimates.length > 0 ? (
                <div className="mt-4">
                  <h3 className="text-sm font-medium text-ink">诊断的初步估计</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {data.summary.estimates.map((e) => (
                      <Badge key={e.skill} tone="blue">
                        {e.skillLabel} {e.levelLabel} · 依据 {e.evidenceCount} 题
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted">只是初步估计，不是官方 CEFR 认证。练习越多，估计越准。</p>
                </div>
              ) : null}
              <ul className="mt-4 flex flex-col gap-1.5 text-sm text-ink">
                <li>· 每天打开“今日”，按顺序做：先复习到期卡片，再学下一节课。</li>
                <li>· 每节课学完，课里的词会自动进入复习。</li>
                <li>· 哪天太累，可以切换成“只复习”，或者跳过某个任务并说明原因。</li>
              </ul>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button onClick={() => finish("/today")} disabled={pending}>
                  {data.completed ? "回到今日" : "开始今天的学习"}
                  <ArrowRight aria-hidden="true" />
                </Button>
                <Button variant="ghost" onClick={() => setStep("welcome")} disabled={pending}>
                  重新设置
                </Button>
              </div>
            </section>
          ) : null}

          {error ? (
            <FormMessage tone="error" className="mt-4">
              {error}
            </FormMessage>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
