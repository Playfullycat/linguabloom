import { clearOffline, clearPack, readQueue, removeFromQueue, savePack, type OfflinePack } from "./store";

export type SyncItemStatus = "stored" | "duplicate" | "stale" | "missing" | "too_old";
export type SyncResult = { sent: number; stored: number; skipped: number; failed: boolean };

export type PackRefresh = "updated" | "signed_out" | "unavailable";

/**
 * Download today's due cards for offline review. Signed out: the stored cards
 * are removed (answers still waiting to be sent are kept until sign-in).
 */
export async function refreshPack(): Promise<PackRefresh> {
  try {
    const response = await fetch("/api/review/offline-pack", { cache: "no-store" });
    if (response.status === 401) {
      clearPack();
      return "signed_out";
    }
    if (!response.ok) return "unavailable";
    savePack((await response.json()) as OfflinePack);
    return "updated";
  } catch {
    return "unavailable";
  }
}

let running: Promise<SyncResult> | null = null;

/**
 * Send queued offline answers. Safe to call often: only one upload runs at a
 * time, failures keep the queue, and repeats are ignored by the server.
 */
export function syncQueue(): Promise<SyncResult> {
  if (running) return running;
  // .finally runs after the promise settles, so the guard is always set first.
  running = upload().finally(() => {
    running = null;
  });
  return running;
}

async function upload(): Promise<SyncResult> {
  const queue = readQueue();
  if (queue.length === 0) return { sent: 0, stored: 0, skipped: 0, failed: false };
  try {
    const response = await fetch("/api/review/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: queue }),
    });
    if (response.status === 409) {
      // Signed in as someone else than the person who reviewed offline: those answers can't be applied.
      clearOffline();
      return { sent: queue.length, stored: 0, skipped: queue.length, failed: false };
    }
    if (!response.ok) return { sent: queue.length, stored: 0, skipped: 0, failed: true };
    const { results } = (await response.json()) as { results: { clientRequestId: string; status: SyncItemStatus }[] };
    removeFromQueue(new Set(results.map((r) => r.clientRequestId)));
    const stored = results.filter((r) => r.status === "stored" || r.status === "duplicate").length;
    return { sent: queue.length, stored, skipped: results.length - stored, failed: false };
  } catch {
    return { sent: queue.length, stored: 0, skipped: 0, failed: true };
  }
}
