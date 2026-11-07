import { PenLine } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { AI_STATUS_LABELS, aiStatus } from "@/modules/ai/provider";
import { CEFR_LEVEL_LABELS } from "@/modules/curriculum/domain/cefr";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { WRITING_TYPE_LABELS, loadWritingPrompts } from "@/modules/writing/content";
import { listWritings, type WritingTask } from "@/modules/writing/services/writing";

export const metadata: Metadata = { title: "Writing" };

const STATUS = { draft: { label: "等待反馈", tone: "yellow" }, feedback: { label: "已有反馈", tone: "blue" }, revised: { label: "已写第二版", tone: "mint" } } as const;

export default function WritingPage() {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <PenLine className="size-4" aria-hidden="true" />
            <span lang="en">Practice</span> · 练习
          </span>
        }
        title="Writing"
        titleZh="写作"
        description="写完先看分层反馈：任务完成度 → 内容 → 语法 → 词汇 → 衔接 → 更自然的说法。先改最重要的问题，再自己写第二版。"
      />
      <Suspense fallback={<LoadingSkeleton label="正在加载…" />}>
        <WritingHome />
      </Suspense>
    </>
  );
}

async function WritingHome() {
  const user = await requireOwner();
  const db = getDb();
  const status = aiStatus();
  const [{ profile }, mine] = await Promise.all([getLearnerSettings(db, user.id), listWritings(db, user.id)]);
  const prompts = loadWritingPrompts();
  const levels = [...new Set(prompts.map((p) => p.level))];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        {!status.available ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted">
              写作反馈需要 AI（{AI_STATUS_LABELS[status.reason]}）。你仍然可以写，文章会先保存，配置好 AI 后再请求反馈。
            </CardContent>
          </Card>
        ) : null}
        {levels.map((level) => (
          <section key={level} aria-labelledby={`wl-${level}`}>
            <h2 id={`wl-${level}`} className="mb-2 text-base font-semibold text-ink">
              {CEFR_LEVEL_LABELS[level]}
            </h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {prompts
                .filter((p) => p.level === level)
                .map((p) => (
                  <li key={p.id}>
                    <Link href={`/writing/new?prompt=${p.id}`} className="flex h-full flex-col gap-1.5 rounded-2xl border border-border bg-surface p-4 shadow-card hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-ring">
                      <span className="font-semibold text-ink">{p.title_zh}</span>
                      <span lang="en" className="text-sm text-muted">
                        {p.title_en}
                      </span>
                      <span className="mt-auto flex flex-wrap gap-1.5 pt-1">
                        <Badge size="sm" tone="primary">
                          {WRITING_TYPE_LABELS[p.type]}
                        </Badge>
                        <Badge size="sm">
                          {p.min_words}–{p.max_words} 词
                        </Badge>
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
        <Link href="/writing/new" className="rounded-2xl border border-dashed border-border-strong p-4 text-sm text-ink hover:bg-surface-soft focus-visible:outline-2 focus-visible:outline-ring">
          <span className="font-semibold">自由写作</span>：自己定题目和要求
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>我写过的</CardTitle>
        </CardHeader>
        <CardContent>
          {mine.length === 0 ? (
            <p className="text-sm text-muted">还没有写过。从左边选一个题目开始吧。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {mine.map((w) => (
                <li key={w.id}>
                  <Link href={`/writing/${w.id}`} className="flex flex-col gap-0.5 rounded-xl border border-border px-3 py-2 hover:bg-surface-soft">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">{(w.task as WritingTask).title}</span>
                      <Badge size="sm" tone={STATUS[w.status as keyof typeof STATUS]?.tone ?? "neutral"}>
                        {STATUS[w.status as keyof typeof STATUS]?.label ?? w.status}
                      </Badge>
                    </span>
                    <span lang="en" className="truncate text-xs text-muted">
                      {w.originalText}
                    </span>
                    <span className="text-xs text-muted">{w.createdAt.toLocaleDateString("zh-CN", { timeZone: profile.timezone })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
