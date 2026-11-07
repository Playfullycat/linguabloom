import Link from "next/link";
import { Suspense } from "react";

import { BrandMark, BrandWordmark } from "@/components/layout/brand-mark";
import { ActiveSidebarLinks, SidebarCollapseToggle, SidebarLinks } from "@/components/layout/sidebar-links";
import { ThemeQuickToggle } from "@/components/layout/theme-controls";

export const SIDEBAR_ID = "app-sidebar";

/**
 * Desktop navigation (≥ lg). Width follows the `data-sidebar` attribute set
 * before paint, so the collapsed state never flashes.
 */
export function Sidebar() {
  return (
    <aside
      id={SIDEBAR_ID}
      className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 ease-[var(--ease-standard)] lg:flex sidebar-collapsed:w-[76px]"
    >
      <div className="flex h-16 items-center gap-2.5 px-5 sidebar-collapsed:justify-center sidebar-collapsed:px-0">
        <Link href="/today" className="flex items-center gap-2.5 rounded-xl">
          <BrandMark />
          <BrandWordmark className="sidebar-collapsed:sr-only" />
        </Link>
      </div>

      <nav aria-label="主导航" className="flex-1 overflow-y-auto px-3 py-2">
        <Suspense fallback={<SidebarLinks pathname={null} section="primary" />}>
          <ActiveSidebarLinks section="primary" />
        </Suspense>
      </nav>

      <div className="flex flex-col gap-1 border-t border-border px-3 py-3">
        <nav aria-label="其他">
          <Suspense fallback={<SidebarLinks pathname={null} section="secondary" />}>
            <ActiveSidebarLinks section="secondary" />
          </Suspense>
        </nav>
        <div className="flex items-center justify-between gap-1 px-1 pt-1 sidebar-collapsed:flex-col">
          <ThemeQuickToggle />
          <SidebarCollapseToggle controls={SIDEBAR_ID} />
        </div>
      </div>
    </aside>
  );
}
