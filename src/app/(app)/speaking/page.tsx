import { Mic } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { FIT_LABELS, FIT_TONES } from "@/components/materials/fit";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { AI_STATUS_LABELS, aiStatus } from "@/modules/ai/provider";
import { CEFR_LEVEL_LABELS } from "@/modules/curriculum/domain/cefr";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { learnerInputLevel, levelFit } from "@/modules/materials/services/materials";
import { SPEAKING_MODE_LABELS, SPEAKING_TYPES, SPEAKING_TYPE_LABELS, loadSpeakingTasks } from "@/modules/speaking/content";
import { listSpeakingAttempts } from "@/modules/speaking/services/speaking";

export const metadata: Metadata = { title: "Speaking" };


export default function SpeakingPage() {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Mic className="size-4" aria-hidden="true" />
            <span lang="en">Practice</span> · 练习
          </span>
        }
        title="Speaking"
        titleZh="口语"
        description="朗读、跟读、简单回答、引导对话、情景对话、故事复述和观点表达。能实时对话就实时对话，网络不好时用标准语音模式（录一句、转写、回复）。"
      />
      <Suspense fallback={<LoadingSkeleton label="正在加载…" />}>
        <SpeakingHome />
      </Suspense>
    </>
  );
}

async function SpeakingHome() {
  const user = await requireOwner();
  const db = getDb();
  const status = aiStatus();
  const [{ profile }, mine, { level }] = await Promise.all([getLearnerSettings(db, user.id), listSpeakingAttempts(db, user.id, 20), learnerInputLevel(db, user.id, "listening")]);
  const tasks = loadSpeakingTasks();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        {!status.available ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted">口语练习需要 AI（{AI_STATUS_LABELS[status.reason]}）。课程里的跟读录音不需要 AI，照常可用。</CardContent>
          </Card>
        ) : status.simulated ? (
          <p className="rounded-2xl border border-dashed border-border-strong p-3 text-sm text-muted">当前是模拟 AI（AI_PROVIDER=mock）：没有真正的语音识别和实时语音，用来试用界面。</p>
        ) : null}
        {SPEAKING_TYPES.map((type) => {
          const list = tasks.filter((t) => t.type === type);
          if (list.length === 0) return null;
          return (
            <section key={type} aria-labelledby={`sp-${type}`}>
              <h2 id={`sp-${type}`} className="mb-2 text-base font-semibold text-ink">
                {SPEAKING_TYPE_LABELS[type]}
              </h2>
              <ul className="grid gap-3 md:grid-cols-2">
                {list.map((t) => {
                  const fit = levelFit(t.level, level);
                  return (
                    <li key={t.id}>
                      <Link href={`/speaking/${t.id}`} className="flex h-full flex-col gap-1.5 rounded-2xl border border-border bg-surface p-4 shadow-card hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-ring">
                        <span className="font-semibold text-ink">{t.title_zh}</span>
                        <span lang="en" className="text-sm text-muted">
                          {t.title_en}
                        </span>
                        <span className="text-sm text-muted">{t.goal_zh}</span>
                        <span className="mt-auto flex flex-wrap gap-1.5 pt-1">
                          <Badge size="sm" tone="primary">
                            {CEFR_LEVEL_LABELS[t.level]}
                          </Badge>
                          <Badge size="sm" tone={FIT_TONES[fit]}>
                            {FIT_LABELS[fit]}
                          </Badge>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>练习记录</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {mine.length === 0 ? (
            <p className="text-sm text-muted">还没有口语练习。从左边选一个任务开始吧。</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="speaking-history">
              {mine.map((a) => (
                <li key={a.id}>
                  <Link href={`/speaking/attempts/${a.id}`} className="flex flex-col gap-0.5 rounded-xl border border-border px-3 py-2 hover:bg-surface-soft">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">{a.task?.title_zh ?? a.promptId}</span>
                      <Badge size="sm" tone={a.status === "active" ? "yellow" : a.hasFeedback ? "blue" : "neutral"}>
                        {a.status === "active" ? "未结束" : a.hasFeedback ? "有反馈" : "没有反馈"}
                      </Badge>
                    </span>
                    <span className="text-xs text-muted">
                      {a.createdAt.toLocaleString("zh-CN", { timeZone: profile.timezone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {SPEAKING_MODE_LABELS[a.mode as "typed"] ?? a.mode} · 说了 {a.learnerTurns} 次
                      {a.audioCount > 0 ? ` · ${a.audioCount} 段录音` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">
            默认不保存录音，转录按你的选择保存。可以在每次练习里删除，或在 <Link href="/settings" className="underline">设置</Link> 里修改默认值、全部删除。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
