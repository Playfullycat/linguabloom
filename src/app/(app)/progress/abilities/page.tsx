import { ArrowLeft, CircleCheck, CircleDashed, CircleDot, Clock, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { cn } from "@/lib/utils";
import { EVIDENCE_TYPE_LABELS, SKILL_LABELS } from "@/modules/abilities/content";
import { STATUS_LABELS } from "@/modules/abilities/domain/status";
import { getAbilityMap, type AbilityItem } from "@/modules/abilities/services/abilities";
import { CEFR_LEVEL_LABELS, isCefrLevel } from "@/modules/curriculum/domain/cefr";
import { SKILLS } from "@/modules/curriculum/content/schema";
import { getLearnerSettings } from "@/modules/learner/services/profile";

export const metadata: Metadata = { title: "Abilities" };

export default function AbilitiesPage({ searchParams }: PageProps<"/progress/abilities">) {
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/progress" className="inline-flex items-center gap-1.5 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            进度
          </Link>
        }
        title="Can-do map"
        titleZh="能力地图"
        description="每条能力描述都要用真实的练习来证明：课程练习、语法练习、理解题、听写、口语和写作。点开可以看到每一条证据。"
      />
      <Suspense fallback={<LoadingSkeleton label="正在整理能力证据…" />}>
        <AbilitiesLoader searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const STATUS_STYLE = {
  shown: { icon: CircleCheck, tone: "mint" },
  emerging: { icon: CircleDot, tone: "blue" },
  not_started: { icon: CircleDashed, tone: "neutral" },
} as const;

async function AbilitiesLoader({ searchParams }: Pick<PageProps<"/progress/abilities">, "searchParams">) {
  const params = await searchParams;
  const user = await requireOwner();
  const db = getDb();
  const { profile } = await getLearnerSettings(db, user.id, getEnv().DEFAULT_TIMEZONE);
  const items = await getAbilityMap(db, user.id, profile.timezone);
  const levels = [...new Set(items.map((i) => i.level))];
  const requested = typeof params.level === "string" && levels.includes(params.level as never) ? params.level : null;
  // Default: the lowest level that still has statements not shown.
  const level = requested ?? levels.find((l) => items.some((i) => i.level === l && i.result.status !== "shown")) ?? levels[0]!;
  const mine = items.filter((i) => i.level === level);
  const label = (l: string) => (isCefrLevel(l) ? CEFR_LEVEL_LABELS[l] : l);

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="等级" className="flex flex-wrap gap-2">
        {levels.map((l) => {
          const all = items.filter((i) => i.level === l);
          const shown = all.filter((i) => i.result.status === "shown").length;
          return (
            <Link
              key={l}
              href={`/progress/abilities?level=${l}`}
              aria-current={l === level ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring",
                l === level ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-ink hover:bg-surface-soft",
              )}
            >
              {label(l)}
              <span className={cn("text-xs", l === level ? "text-primary-foreground/80" : "text-muted")}>
                {shown}/{all.length}
              </span>
            </Link>
          );
        })}
      </nav>

      <p className="flex items-start gap-2 rounded-2xl bg-blue-soft p-4 text-sm text-blue-ink">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        “已展示”表示你在不同的日子里多次做到了，最近的正确率也够高；口语、写作类还需要至少一次任务反馈，不能只靠自评。这是学习记录，不是官方 CEFR 认证，也不会直接改变你的水平估计。
      </p>

      {SKILLS.filter((s) => mine.some((i) => i.skill === s)).map((skill) => (
        <section key={skill} aria-labelledby={`skill-${skill}`} className="flex flex-col gap-2">
          <h2 id={`skill-${skill}`} className="text-base font-semibold text-ink">
            {SKILL_LABELS[skill]}
          </h2>
          <ul className="grid gap-3 lg:grid-cols-2">
            {mine
              .filter((i) => i.skill === skill)
              .map((item) => (
                <li key={item.id}>
                  <AbilityCard item={item} timeZone={profile.timezone} />
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AbilityCard({ item, timeZone }: { item: AbilityItem; timeZone: string }) {
  const style = STATUS_STYLE[item.result.status];
  const Icon = style.icon;
  const date = (d: Date) => d.toLocaleDateString("zh-CN", { timeZone, month: "numeric", day: "numeric" });
  return (
    <Card className="h-full" data-testid={`can-do-${item.id}`}>
      <CardContent className="flex h-full flex-col gap-3 pt-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={style.tone} className="gap-1">
            <Icon className="size-3.5" aria-hidden="true" />
            {STATUS_LABELS[item.result.status]}
          </Badge>
          {item.result.stale ? (
            <Badge tone="yellow" className="gap-1">
              <Clock className="size-3.5" aria-hidden="true" />
              很久没练了
            </Badge>
          ) : null}
          {item.result.evidenceCount > 0 ? <Badge tone="outline">证据 {item.result.evidenceCount} 条</Badge> : null}
          {item.result.lastVerifiedAt ? <span className="text-xs text-muted">最近一次：{date(item.result.lastVerifiedAt)}</span> : null}
        </div>
        <div>
          <p className="text-[0.9375rem] font-medium text-ink">{item.zh}</p>
          <p lang="en" className="text-sm text-muted">
            {item.en}
          </p>
        </div>
        {item.result.status === "emerging" && item.result.missing.length > 0 ? (
          <ul className="text-xs text-muted">
            {item.result.missing.map((m) => (
              <li key={m}>· {m}</li>
            ))}
          </ul>
        ) : null}
        {item.recent.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">看证据</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {item.recent.map((e) => (
                <li key={e.id} className="flex items-center gap-2">
                  <span className={cn("w-10 shrink-0 text-xs font-medium", e.outcome === "pass" ? "text-mint-ink" : "text-coral-ink")}>{e.outcome === "pass" ? "做到" : "没做到"}</span>
                  {e.href ? (
                    <Link href={e.href} className="text-primary-ink hover:underline">
                      {e.label}
                    </Link>
                  ) : (
                    <span>{e.label}</span>
                  )}
                  <span className="text-xs text-muted">
                    {date(e.occurredAt)}
                    {e.confidence === "low" ? " · 自评或把握较低（算半次）" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <div className="mt-auto text-xs text-muted">
          {item.routes.length === 0 ? (
            "目前还没有能证明这一条的练习内容。"
          ) : (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>去练：</span>
              {item.routes.slice(0, 4).map((r) => (
                <Link key={`${r.type}-${r.id}`} href={r.href} className="text-primary-ink hover:underline">
                  {r.title}
                  <span className="text-muted">（{EVIDENCE_TYPE_LABELS[r.type]}）</span>
                </Link>
              ))}
              {item.routes.length > 4 ? <span>等 {item.routes.length} 处</span> : null}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
