"use client";

import { WifiOff } from "lucide-react";
import { useOffline } from "next/offline";
import { useEffect } from "react";

import { refreshPack, syncQueue } from "@/lib/offline/sync";

const REFRESH_EVERY_MS = 10 * 60_000;

/**
 * Weak network and offline review (Phase 5.3), mounted once in the signed-in
 * area: registers the service worker, keeps the offline review pack fresh,
 * sends answers given offline as soon as the connection is back, and tells
 * the learner when the app is offline (pending actions retry automatically).
 */
export function OfflineSupport() {
  const offline = useOffline();

  useEffect(() => {
    // The worker caches build assets by hash; in development they change constantly.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const run = () => {
      void syncQueue().then(() => refreshPack());
    };
    run();
    window.addEventListener("online", run);
    const timer = window.setInterval(run, REFRESH_EVERY_MS);
    return () => {
      window.removeEventListener("online", run);
      window.clearInterval(timer);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-xl items-start gap-2.5 rounded-xl border border-yellow/60 bg-yellow-soft px-3.5 py-2.5 text-sm text-yellow-ink shadow-raised"
    >
      <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>
        网络断开了。正在等待连接，未完成的操作会在恢复后自动重试，不会丢失。断网时也可以{" "}
        {/* A full page load on purpose: the service worker serves the offline page. */}
        <a href="/offline" className="font-medium underline underline-offset-2">
          离线复习到期的卡片
        </a>
        。
      </p>
    </div>
  );
}
