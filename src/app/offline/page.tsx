import type { Metadata } from "next";
import Link from "next/link";

import { OfflineReview } from "@/components/review/offline-review";

export const metadata: Metadata = { title: "离线复习" };

/**
 * The offline shell (Phase 5.3). A static page with no personal data: the
 * service worker keeps it, and the cards come from this browser's storage.
 * Shown instead of any page that can't load while offline.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-4 py-8 sm:py-12">
      <header className="flex flex-col gap-1">
        <Link href="/today" className="inline-flex min-h-6 items-center self-start text-sm font-medium text-primary-ink">
          LinguaBloom
        </Link>
        <h1 className="text-2xl font-semibold text-ink">离线复习</h1>
        <p className="text-sm text-muted">没有网络时，可以先复习下载到这台设备上的到期卡片。恢复网络后，复习记录会自动同步，不会重复记录。</p>
      </header>
      <OfflineReview />
    </main>
  );
}
