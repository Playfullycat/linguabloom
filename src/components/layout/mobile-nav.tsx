"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isNavEntryActive, mobileNav } from "@/lib/config/navigation";
import { cn } from "@/lib/utils";

/** Pure bottom bar; `pathname === null` renders without an active item (Suspense fallback). */
export function MobileNavBar({ pathname }: { pathname: string | null }) {
  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {mobileNav.map((entry) => {
          const active = pathname !== null && isNavEntryActive(entry, pathname);
          const Icon = entry.icon;
          return (
            <li key={entry.key}>
              <Link
                href={entry.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium transition-colors",
                  active ? "text-primary-ink" : "text-muted hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "grid h-7 w-12 place-items-center rounded-full transition-colors duration-150",
                    active && "bg-primary-soft",
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span lang="en">{entry.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Reads the URL; must render inside <Suspense> (Cache Components + dynamic routes). */
export function ActiveMobileNavBar() {
  const pathname = usePathname();
  return <MobileNavBar pathname={pathname} />;
}
