"use client";

import { CircleCheck, CircleX, CloudOff, CloudUpload, Volume2, Wifi } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ReviewRatingBar } from "@/components/review/review-rating-bar";
import { offlineSnapshot, queueAnswer, subscribeOffline, type OfflinePack, type QueuedAnswer } from "@/lib/offline/store";
import { refreshPack, syncQueue } from "@/lib/offline/sync";
import { CARD_TYPE_INFO, isTypedAnswerCorrect, isTypedCard, type Grade } from "@/modules/review/domain/cards";
import type { ClientReviewCard } from "@/modules/review/services/review";

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function parse(snapshot: string): { pack: OfflinePack | null; queue: QueuedAnswer[] } {
  const [packRaw = "", queueRaw = ""] = snapshot.split("\u0000");
  try {
    return { pack: packRaw ? (JSON.parse(packRaw) as OfflinePack) : null, queue: queueRaw ? (JSON.parse(queueRaw) as QueuedAnswer[]) : [] };
  } catch {
    return { pack: null, queue: [] };
  }
}

function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  window.speechSynthesis.speak(u);
}

/**
 * Offline review (Phase 5.3): the due cards downloaded while online, rated
 * here without a connection. Answers wait in this browser and are sent when
 * the connection returns; the server schedules them at the time they were given.
 */
export function OfflineReview() {
  const snapshot = useSyncExternalStore(subscribeOffline, offlineSnapshot, () => "");
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const { pack, queue } = useMemo(() => parse(snapshot), [snapshot]);
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Whenever the connection is there: send what is waiting, then fetch a fresh pack.
  useEffect(() => {
    if (!online) return;
    void syncQueue().then(() => refreshPack());
  }, [online]);

  const syncNow = async () => {
    setSyncing(true);
    const result = await syncQueue();
    const refresh = await refreshPack();
    setSyncing(false);
    if (result.failed) setMessage("同步没有成功，记录还保存在这台设备上，稍后会自动重试。");
    else if (refresh === "signed_out") setMessage("请先登录，登录后会自动同步离线复习记录。");
    else if (result.sent === 0) setMessage("没有需要同步的记录，复习包已更新。");
    else setMessage(`已同步 ${result.stored} 条复习记录${result.skipped > 0 ? `，${result.skipped} 条因为卡片在别处复习过或已失效而跳过` : ""}。`);
  };

  const rate = (card: ClientReviewCard, grade: Grade, typed: string | undefined) => {
    if (!pack) return;
    queueAnswer({ userId: pack.userId, cardId: card.id, rating: grade, clientRequestId: crypto.randomUUID(), reviewedAt: new Date().toISOString(), typed });
    setMessage(null);
    if (navigator.onLine) void syncQueue();
  };

  const current = pack?.cards[0] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" data-testid="offline-status">
        {online ? (
          <Badge tone="mint">
            <Wifi aria-hidden="true" />
            已联网
          </Badge>
        ) : (
          <Badge tone="yellow">
            <CloudOff aria-hidden="true" />
            离线中
          </Badge>
        )}
        <span className="text-sm text-muted" data-testid="offline-pending">
          {queue.length > 0 ? `${queue.length} 条复习记录等待同步` : "没有待同步的记录"}
        </span>
        {online && queue.length > 0 ? (
          <Button type="button" size="sm" variant="outline" onClick={syncNow} disabled={syncing}>
            <CloudUpload aria-hidden="true" />
            {syncing ? "正在同步…" : "立即同步"}
          </Button>
        ) : null}
      </div>
      {message ? (
        <p role="status" className="text-sm text-ink">
          {message}
        </p>
      ) : null}

      {!pack ? (
        <Card>
          <CardContent className="flex flex-col gap-2 py-6">
            <p className="font-medium text-ink">这台设备上还没有离线复习包。</p>
            <p className="text-sm text-muted">联网并登录后打开任意页面，到期的卡片会自动下载到这台设备，之后断网也能复习。</p>
            <Link href="/today" className="text-sm font-medium text-primary-ink underline underline-offset-2">
              去今日计划
            </Link>
          </CardContent>
        </Card>
      ) : !current ? (
        <Card>
          <CardContent className="flex flex-col gap-2 py-6" data-testid="offline-done">
            <p className="flex items-center gap-2 font-medium text-ink">
              <CircleCheck className="size-5 text-mint-ink" aria-hidden="true" />
              离线复习包里的卡片都复习完了。
            </p>
            <p className="text-sm text-muted">{online ? "联网后会自动同步，并下载新的到期卡片。" : "恢复网络后会自动同步。"}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted">
            还剩 <span className="font-semibold text-ink tabular-nums">{pack.cards.length}</span> 张 · 复习包更新于 {new Date(pack.generatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
          <OfflineCard key={current.id} card={current} onRate={rate} />
          <p className="text-xs text-muted">离线时每张卡只复习一次；同步后按正常规则安排下一次复习。打字题的对错以同步后服务器的判断为准。</p>
        </>
      )}
    </div>
  );
}

function OfflineCard({ card, onRate }: { card: ClientReviewCard; onRate: (card: ClientReviewCard, grade: Grade, typed: string | undefined) => void }) {
  const typedCard = isTypedCard(card.cardType);
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState("");
  const correct = typedCard && revealed ? isTypedAnswerCorrect({ text: card.text, exampleEn: card.exampleEn }, card.cardType, typed) : null;
  const grades: Grade[] = !typedCard ? [1, 2, 3, 4] : correct ? [2, 3, 4] : [1];
  const listenFirst = card.cardType === "listening" || card.cardType === "spelling";

  return (
    <Card data-testid="offline-card">
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex items-center justify-between gap-2">
          <Badge tone="neutral" size="sm">
            {CARD_TYPE_INFO[card.cardType].label}
          </Badge>
          {card.isNew ? <Badge tone="blue" size="sm">新卡</Badge> : null}
        </div>

        <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-center">
          {card.cardType === "recognition" ? (
            <p lang="en" className="text-2xl font-semibold text-ink">
              {card.text}
            </p>
          ) : card.cardType === "recall" ? (
            <p className="text-xl font-semibold text-ink">{card.zh}</p>
          ) : card.cardType === "cloze" && card.cloze ? (
            <p lang="en" className="text-lg text-ink">
              {card.cloze.sentence}
            </p>
          ) : null}
          {listenFirst || card.cardType === "recognition" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => speak(card.spoken)}>
              <Volume2 aria-hidden="true" />
              {listenFirst ? "播放读音" : "听一听"}
            </Button>
          ) : null}
        </div>

        {typedCard && !revealed ? (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              setRevealed(true);
            }}
          >
            <label className="sr-only" htmlFor={`offline-typed-${card.id}`}>
              写出英文
            </label>
            <input
              id={`offline-typed-${card.id}`}
              lang="en"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="写出英文"
              className="h-11 flex-1 rounded-xl border border-border bg-surface px-3 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit">检查</Button>
          </form>
        ) : null}

        {!typedCard && !revealed ? (
          <Button type="button" onClick={() => setRevealed(true)}>
            显示答案
          </Button>
        ) : null}

        {revealed ? (
          <div className="flex flex-col gap-3" data-testid="offline-answer">
            {typedCard ? (
              <p className={`flex items-center gap-1.5 text-sm font-medium ${correct ? "text-mint-ink" : "text-coral-ink"}`}>
                {correct ? <CircleCheck className="size-4" aria-hidden="true" /> : <CircleX className="size-4" aria-hidden="true" />}
                {correct ? "答对了" : "还不对"}
              </p>
            ) : null}
            <div className="rounded-xl bg-surface-soft px-4 py-3 text-center">
              <p lang="en" className="text-lg font-semibold text-ink">
                {card.text} {card.ipa ? <span className="text-sm font-normal text-muted">{card.ipa}</span> : null}
              </p>
              <p className="text-ink">{card.zh}</p>
              <p lang="en" className="mt-1 text-sm text-muted">
                {card.exampleEn}
              </p>
              <p className="text-sm text-muted">{card.exampleZh}</p>
            </div>
            <ReviewRatingBar grades={grades} onRate={(g) => onRate(card, g, typedCard ? typed : undefined)} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
