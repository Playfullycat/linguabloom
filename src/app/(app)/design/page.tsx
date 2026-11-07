import { ArrowRight, Inbox, Plus } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LevelBadge } from "@/components/learning/level-badge";
import { PageHeader, SectionHeader } from "@/components/layout/page-header";
import { ThemePreferenceControl } from "@/components/layout/theme-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { ProgressRing } from "@/components/ui/progress-ring";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { CEFR_LEVELS } from "@/modules/curriculum/domain/cefr";

export const metadata: Metadata = { title: "Design system" };

// Class names are written out in full so Tailwind can detect them.
const swatches = [
  { token: "--bg", className: "bg-bg" },
  { token: "--surface", className: "bg-surface" },
  { token: "--surface-soft", className: "bg-surface-soft" },
  { token: "--ink", className: "bg-ink" },
  { token: "--muted", className: "bg-muted" },
  { token: "--border", className: "bg-border" },
  { token: "--primary", className: "bg-primary" },
  { token: "--primary-soft", className: "bg-primary-soft" },
  { token: "--blue", className: "bg-blue" },
  { token: "--mint", className: "bg-mint" },
  { token: "--coral", className: "bg-coral" },
  { token: "--yellow", className: "bg-yellow" },
];

const inkPairs = [
  { name: "primary", className: "bg-primary-soft text-primary-ink" },
  { name: "blue", className: "bg-blue-soft text-blue-ink" },
  { name: "mint", className: "bg-mint-soft text-mint-ink" },
  { name: "coral", className: "bg-coral-soft text-coral-ink" },
  { name: "yellow", className: "bg-yellow-soft text-yellow-ink" },
];

/** Development-only gallery of tokens and components. 404 in production builds. */
export default function DesignPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <>
      <PageHeader
        eyebrow="开发用 · 仅在 dev 模式可见"
        title="Design system"
        titleZh="设计系统"
        description="设计令牌与基础组件一览。切换主题检查深色模式。"
        actions={<ThemePreferenceControl />}
      />

      <div className="flex flex-col gap-12">
        <section>
          <SectionHeader title="颜色令牌" description="强调色是填充色；文字请用对应的 *-ink。" />
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {swatches.map((s) => (
              <li key={s.token} className="flex flex-col gap-2">
                <span className={`h-14 rounded-2xl border border-border ${s.className}`} />
                <code className="text-xs text-muted">{s.token}</code>
              </li>
            ))}
          </ul>
          <ul className="mt-4 flex flex-wrap gap-2">
            {inkPairs.map((p) => (
              <li key={p.name} className={`rounded-xl px-3 py-2 text-sm font-medium ${p.className}`}>
                {p.name}-ink on {p.name}-soft
              </li>
            ))}
          </ul>
        </section>

        <section>
          <SectionHeader title="字体" />
          <Card>
            <CardContent className="flex flex-col gap-4">
              <p lang="en" className="text-3xl font-semibold tracking-tight">
                Small steps, every day.
              </p>
              <p className="text-base">中文界面使用系统中文字体栈，英文使用 Geist Sans。</p>
              <p lang="en" className="font-reading text-lg leading-relaxed">
                Reading mode uses a serif face: &ldquo;Hello! How are you?&rdquo; &ldquo;I&rsquo;m fine, thank you.&rdquo;
              </p>
              <p className="font-ipa text-lg">
                IPA: /həˈləʊ/ · /ˈθæŋk juː/ · /ʃ ʒ ŋ ð θ ɜː/
              </p>
              <p className="tabular-nums text-muted">Tabular numbers: 0123456789 · 12:05 · 98.6%</p>
            </CardContent>
          </Card>
        </section>

        <section>
          <SectionHeader title="按钮" />
          <div className="flex flex-wrap items-center gap-3">
            <Button>
              Start learning <ArrowRight aria-hidden="true" />
            </Button>
            <Button variant="soft">Soft</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">删除数据</Button>
            <Button disabled>Disabled</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" variant="outline">
              <Plus aria-hidden="true" />
              <span className="sr-only">添加</span>
            </Button>
          </div>
        </section>

        <section>
          <SectionHeader title="徽章与等级" />
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge>neutral</Badge>
              <Badge tone="primary">primary</Badge>
              <Badge tone="blue">blue</Badge>
              <Badge tone="mint">已掌握</Badge>
              <Badge tone="coral">值得再练一次</Badge>
              <Badge tone="yellow">待复习</Badge>
              <Badge tone="outline">outline</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {CEFR_LEVELS.map((level) => (
                <LevelBadge key={level} level={level} />
              ))}
              <LevelBadge level="a1" estimated />
            </div>
          </div>
        </section>

        <section>
          <SectionHeader title="进度环" />
          <div className="flex flex-wrap items-center gap-6">
            <ProgressRing value={0} label="完成 0%" />
            <ProgressRing value={0.35} label="完成 35%" tone="blue" />
            <ProgressRing value={0.7} label="完成 70%" tone="mint" />
            <ProgressRing value={1} label="完成 100%" tone="coral" size={80} strokeWidth={8} />
          </div>
        </section>

        <section>
          <SectionHeader title="卡片" />
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Unit 3 · Hello!</CardTitle>
                <CardDescription>问候、道别和礼貌用语（示例卡片，非真实进度）</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-4">
                <ProgressRing value={0.4} label="示例进度 40%" />
                <LevelBadge level="pre_a1" />
              </CardContent>
              <CardFooter>
                <Button size="sm">继续</Button>
              </CardFooter>
            </Card>
            <Card className="bg-surface-soft shadow-none">
              <CardHeader>
                <CardTitle>Soft card</CardTitle>
                <CardDescription>次级信息区块。</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted">surface-soft 背景，无阴影。</CardContent>
            </Card>
          </div>
        </section>

        <section>
          <SectionHeader title="状态" description="空状态、错误状态、加载状态" />
          <div className="grid gap-4 lg:grid-cols-2">
            <EmptyState
              icon={Inbox}
              title="还没有收藏的单词"
              description="阅读时点击单词，就能把它加入词汇库。"
              action={<Button variant="soft">去阅读</Button>}
            />
            <ErrorState action={<Button variant="outline">再试一次</Button>} />
          </div>
          <div className="mt-4">
            <LoadingSkeleton />
          </div>
        </section>
      </div>
    </>
  );
}
