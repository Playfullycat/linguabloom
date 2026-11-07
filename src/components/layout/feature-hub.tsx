import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import type { NavGroup } from "@/lib/config/navigation";

/** Landing page for a nav group (Learn / Practice): one card per feature. */
export function FeatureHub({ group }: { group: NavGroup }) {
  return (
    <>
      <PageHeader title={group.label} titleZh={group.labelZh} description={group.summary} />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {group.children.map((feature) => {
          const Icon = feature.icon;
          return (
            <li key={feature.key}>
              <Link
                href={feature.href}
                className="group flex h-full flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-card transition-[border-color,box-shadow,transform] duration-200 ease-[var(--ease-standard)] hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-raised"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-11 place-items-center rounded-2xl bg-primary-soft text-primary-ink">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  {feature.available ? (
                    <Badge tone="mint" size="sm">
                      可以使用
                    </Badge>
                  ) : (
                    <Badge tone="yellow" size="sm">
                      Phase {feature.phase}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <h2 className="flex flex-wrap items-baseline gap-x-2">
                    <span lang="en" className="text-base font-semibold text-ink">
                      {feature.label}
                    </span>
                    <span className="text-sm text-muted">{feature.labelZh}</span>
                  </h2>
                  <p className="text-sm leading-relaxed text-muted">{feature.summary}</p>
                </div>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-primary-ink">
                  查看
                  <ArrowRight
                    className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
