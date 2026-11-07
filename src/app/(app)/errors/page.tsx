import { NotebookPen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { errorStatus } from "@/components/errors/labels";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { ERROR_CATEGORIES } from "@/db/schema";
import { requireOwner } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { listErrors } from "@/modules/errors/services/errors";
import { ERROR_CATEGORY_LABELS } from "@/modules/grammar/content";
import { getLearnerSettings } from "@/modules/learner/services/profile";

export const metadata: Metadata = { title: "Error Notebook" };

const STATUSES = [
  { value: "active", label: "未解决" },
  { value: "retest", label: "等待再测" },
  { value: "resolved", label: "已解决" },
];

export default function ErrorNotebookPage({ searchParams }: PageProps<"/errors">) {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <NotebookPen className="size-4" aria-hidden="true" />
            <span lang="en">Practice</span> · 练习
          </span>
        }
        title="Error Notebook"
        titleZh="错误本"
        description="课程、复习、语法练习、阅读和听力里做错的题都会记在这里，按错误类型和知识点归类。同一个错误出现两次，就会安排补救练习；通过后隔天换题再测。"
      />
      <Suspense fallback={<LoadingSkeleton label="正在加载错误本…" />}>
        <Notebook searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-ring",
        active ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-surface text-ink hover:bg-surface-soft",
      )}
    >
      {children}
    </Link>
  );
}

async function Notebook({ searchParams }: Pick<PageProps<"/errors">, "searchParams">) {
  const params = await searchParams;
  const status = typeof params.status === "string" && STATUSES.some((s) => s.value === params.status) ? params.status : undefined;
  const category = typeof params.category === "string" && (ERROR_CATEGORIES as readonly string[]).includes(params.category) ? params.category : undefined;
  const user = await requireOwner();
  const db = getDb();
  const [{ profile }, all, items] = await Promise.all([getLearnerSettings(db, user.id), listErrors(db, user.id), listErrors(db, user.id, { status, category })]);
  const tz = profile.timezone;
  const href = (next: { status?: string; category?: string }) => {
    const q = new URLSearchParams();
    if (next.status) q.set("status", next.status);
    if (next.category) q.set("category", next.category);
    const s = q.toString();
    return s ? `/errors?${s}` : "/errors";
  };
  const usedCategories = ERROR_CATEGORIES.filter((c) => all.some((i) => i.category === c));

  if (all.length === 0) {
    return <EmptyState icon={NotebookPen} title="错误本还是空的" description="做课程、复习打字题、语法练习、阅读理解题或听写时答错的题，会自动记到这里。" />;
  }

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "未解决", value: all.filter((i) => i.status === "active").length },
          { label: "需要补救", value: all.filter((i) => i.needsRemediation).length },
          { label: "等待再测", value: all.filter((i) => i.status === "retest").length },
          { label: "已解决", value: all.filter((i) => i.status === "resolved").length },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl bg-surface p-4 shadow-card">
            <dt className="text-sm text-muted">{s.label}</dt>
            <dd className="text-2xl font-semibold text-ink">{s.value}</dd>
          </div>
        ))}
      </dl>

      <nav aria-label="按状态筛选" className="flex flex-wrap gap-2">
        <Chip href={href({ category })} active={!status}>
          全部
        </Chip>
        {STATUSES.map((s) => (
          <Chip key={s.value} href={href({ status: s.value, category })} active={status === s.value}>
            {s.label}
          </Chip>
        ))}
      </nav>
      {usedCategories.length > 1 ? (
        <nav aria-label="按错误类型筛选" className="flex flex-wrap gap-2">
          <Chip href={href({ status })} active={!category}>
            全部类型
          </Chip>
          {usedCategories.map((c) => (
            <Chip key={c} href={href({ status, category: c })} active={category === c}>
              {ERROR_CATEGORY_LABELS[c]}
            </Chip>
          ))}
        </nav>
      ) : null}

      {items.length === 0 ? <p className="text-sm text-muted">没有符合筛选条件的记录。</p> : null}
      <ul className="flex flex-col gap-3" aria-label="错误记录">
        {items.map((i) => {
          const s = errorStatus(i);
          return (
            <li key={i.id}>
              <Link
                href={`/errors/${i.id}`}
                className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 shadow-card hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="primary">{ERROR_CATEGORY_LABELS[i.category as keyof typeof ERROR_CATEGORY_LABELS] ?? i.category}</Badge>
                  <span className="font-semibold text-ink">{i.title}</span>
                  <Badge tone={s.tone}>{s.label}</Badge>
                  <span className="ml-auto text-sm text-muted">出现 {i.occurrenceCount} 次</span>
                </div>
                {i.lastWrong ? (
                  <p lang="en" className="text-sm">
                    <span className="sr-only">最近一次写的：</span>
                    <span className="text-coral-ink line-through decoration-coral/60">{i.lastWrong}</span>
                    {i.lastCorrect ? (
                      <>
                        <span className="text-muted"> → </span>
                        <span className="sr-only">正确：</span>
                        <span className="text-mint-ink">{i.lastCorrect}</span>
                      </>
                    ) : null}
                  </p>
                ) : null}
                <p className="text-xs text-muted">
                  首次 {i.firstSeenAt.toLocaleDateString("zh-CN", { timeZone: tz })} · 最近 {i.lastSeenAt.toLocaleDateString("zh-CN", { timeZone: tz })}
                  {i.recurredCount > 0 ? ` · 解决后又出现过 ${i.recurredCount} 次` : ""}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
