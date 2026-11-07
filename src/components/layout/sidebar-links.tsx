"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  isNavGroup,
  isPathActive,
  primaryNav,
  secondaryNav,
  type Feature,
} from "@/lib/config/navigation";
import { applySidebarState, readSidebarState } from "@/lib/ui-prefs";
import { cn } from "@/lib/utils";

type Section = "primary" | "secondary";

function SidebarLink({ feature, active }: { feature: Feature; active: boolean }) {
  const Icon = feature.icon;
  return (
    <Link
      href={feature.href}
      aria-current={active ? "page" : undefined}
      title={`${feature.label} · ${feature.labelZh}`}
      className={cn(
        "group flex h-10 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm transition-colors duration-150",
        "sidebar-collapsed:justify-center sidebar-collapsed:px-0",
        active ? "bg-primary-soft text-primary-ink" : "text-muted hover:bg-surface-soft hover:text-ink",
      )}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden="true" />
      <span className="flex min-w-0 items-baseline gap-1.5 sidebar-collapsed:sr-only">
        <span lang="en" className={cn("truncate font-medium", active ? "text-primary-ink" : "text-ink")}>
          {feature.label}
        </span>
        <span className="truncate text-xs">{feature.labelZh}</span>
      </span>
    </Link>
  );
}

/** Pure list; `pathname === null` renders without an active item (Suspense fallback). */
export function SidebarLinks({ pathname, section }: { pathname: string | null; section: Section }) {
  const isActive = (href: string) => pathname !== null && isPathActive(pathname, href);

  if (section === "secondary") {
    return (
      <ul className="flex flex-col gap-0.5">
        {secondaryNav.map((feature) => (
          <li key={feature.key}>
            <SidebarLink feature={feature} active={isActive(feature.href)} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {primaryNav.map((entry) =>
        isNavGroup(entry) ? (
          <li key={entry.key} className="mt-4 first:mt-0">
            <Link
              href={entry.href}
              aria-current={pathname === entry.href ? "page" : undefined}
              className={cn(
                "mb-1 flex h-7 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold tracking-wide transition-colors",
                "sidebar-collapsed:justify-center sidebar-collapsed:px-0",
                pathname === entry.href ? "text-primary-ink" : "text-muted hover:text-ink",
              )}
            >
              <span aria-hidden="true" className="hidden h-px w-6 bg-border-strong sidebar-collapsed:block" />
              <span className="sidebar-collapsed:sr-only">
                <span lang="en" className="uppercase">
                  {entry.label}
                </span>
                <span className="ml-1.5 font-normal">{entry.labelZh}</span>
              </span>
            </Link>
            <ul className="flex flex-col gap-0.5">
              {entry.children.map((child) => (
                <li key={child.key}>
                  <SidebarLink feature={child} active={isActive(child.href)} />
                </li>
              ))}
            </ul>
          </li>
        ) : (
          <li key={entry.key}>
            <SidebarLink feature={entry} active={isActive(entry.href)} />
          </li>
        ),
      )}
    </ul>
  );
}

/** Reads the URL; must render inside <Suspense> (Cache Components + dynamic routes). */
export function ActiveSidebarLinks({ section }: { section: Section }) {
  const pathname = usePathname();
  return <SidebarLinks pathname={pathname} section={section} />;
}

/** Icon and label follow `data-sidebar` via CSS, so they are right before hydration. */
export function SidebarCollapseToggle({ controls }: { controls: string }) {
  const toggle = () => applySidebarState(readSidebarState() === "collapsed" ? "expanded" : "collapsed");
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-controls={controls}
      className="text-muted hover:text-ink"
    >
      <PanelLeftClose className="sidebar-collapsed:hidden" aria-hidden="true" />
      <PanelLeftOpen className="hidden sidebar-collapsed:block" aria-hidden="true" />
      <span className="sr-only sidebar-collapsed:hidden">收起侧栏</span>
      <span className="sr-only hidden sidebar-collapsed:inline">展开侧栏</span>
    </Button>
  );
}
