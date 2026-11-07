import { Suspense, type ReactNode } from "react";

import { MobileHeader } from "@/components/layout/mobile-header";
import { ActiveMobileNavBar, MobileNavBar } from "@/components/layout/mobile-nav";
import { Sidebar } from "@/components/layout/sidebar";

export const MAIN_CONTENT_ID = "main-content";

/**
 * Signed-in application frame: sidebar on desktop, top bar + bottom
 * navigation on mobile. Content width capped at 1200px (spec §6.5).
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:flex">
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only z-50 rounded-[var(--radius-control)] bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        跳到主要内容
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="mx-auto w-full max-w-[1200px] flex-1 px-4 pt-6 pb-28 outline-none sm:px-6 lg:px-10 lg:pt-10 lg:pb-14"
        >
          {children}
        </main>
      </div>
      <Suspense fallback={<MobileNavBar pathname={null} />}>
        <ActiveMobileNavBar />
      </Suspense>
    </div>
  );
}
