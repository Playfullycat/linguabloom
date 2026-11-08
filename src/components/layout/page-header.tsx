import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  /** Small line above the title, e.g. the parent section. */
  eyebrow?: ReactNode;
  /** English title (learning-language label). */
  title: string;
  /** Chinese title shown next to the English one. */
  titleZh?: string;
  description?: ReactNode;
  /** Badges or buttons aligned to the right on wide screens. */
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ eyebrow, title, titleZh, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        {/* Back links in the eyebrow get a 24px-tall tap target (WCAG 2.5.8). */}
        {eyebrow ? <div className="text-sm font-medium text-muted [&_a]:inline-flex [&_a]:min-h-6 [&_a]:items-center">{eyebrow}</div> : null}
        <h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span lang="en" className="text-[1.75rem] font-semibold tracking-tight text-ink sm:text-3xl">
            {title}
          </span>
          {titleZh ? <span className="text-lg font-medium text-muted">{titleZh}</span> : null}
        </h1>
        {description ? <div className="max-w-2xl text-[0.9375rem] leading-relaxed text-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}
