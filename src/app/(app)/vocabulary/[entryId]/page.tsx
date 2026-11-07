import { AlertTriangle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader, SectionHeader } from "@/components/layout/page-header";
import { SpeakButton } from "@/components/media/speak-button";
import { AddCardTypeButton, SuspendCardButton } from "@/components/review/card-controls";
import { VocabularyStatusBadge } from "@/components/review/vocabulary-status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { describeDueIn } from "@/lib/time";
import { CARD_TYPE_INFO, RATING_LABELS, availableCardTypes, spokenText, type Grade } from "@/modules/review/domain/cards";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { getVocabularyDetail } from "@/modules/review/services/review";

export const metadata: Metadata = { title: "Word" };

const STATE_LABELS = ["未学", "学习中", "复习中", "重新学习"];

export default function VocabularyDetailPage({ params }: PageProps<"/vocabulary/[entryId]">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在加载词条…" />}>
      <Detail params={params} />
    </Suspense>
  );
}

async function Detail({ params }: Pick<PageProps<"/vocabulary/[entryId]">, "params">) {
  const { entryId: rawId } = await params;
  const entryId = decodeURIComponent(rawId);
  const user = await requireOwner();
  const db = getDb();
  const [detail, { profile }] = await Promise.all([
    getVocabularyDetail(db, user.id, entryId),
    getLearnerSettings(db, user.id, getEnv().DEFAULT_TIMEZONE),
  ]);
  if (!detail) notFound();

  const { entry, vocabulary, cards, history, sourceLesson, sourceMaterial } = detail;
  const now = new Date();
  const timeZone = profile.timezone;
  const existingTypes = new Set(cards.map((c) => c.cardType));
  const missing = availableCardTypes(entry).filter((t) => !existingTypes.has(t));

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/vocabulary" className="hover:text-ink">
            ← 词汇
          </Link>
        }
        title={entry.text}
        titleZh={entry.definitionZh}
        actions={<VocabularyStatusBadge status={vocabulary.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <SpeakButton text={spokenText(entry.text)} size="md" />
                <span lang="en" className="text-xl font-semibold text-ink">{entry.text}</span>
                {entry.ipa ? <span className="font-ipa text-muted">{entry.ipa}</span> : null}
                <Badge size="sm">{entry.partOfSpeech}</Badge>
              </div>
              <p className="text-ink">{entry.definitionZh}</p>
              <div className="flex items-start gap-1 rounded-xl bg-surface-soft p-3 text-sm">
                <SpeakButton text={entry.exampleEn} label={`朗读例句：${entry.exampleEn}`} />
                <span className="flex flex-col">
                  <span lang="en" className="text-ink">{entry.exampleEn}</span>
                  <span className="text-muted">{entry.exampleZh}</span>
                </span>
              </div>
              <p className="text-xs text-muted">
                来源：
                {sourceLesson ? (
                  <Link href={`/lesson/${sourceLesson.id}`} className="text-primary-ink hover:underline">
                    <span lang="en">{sourceLesson.titleEn}</span>（{sourceLesson.titleZh}）
                  </Link>
                ) : sourceMaterial ? (
                  <Link href={`/${sourceMaterial.type}/${sourceMaterial.id}`} className="text-primary-ink hover:underline">
                    {sourceMaterial.type === "reading" ? "阅读" : "听力"}：<span lang="en">{sourceMaterial.titleEn}</span>（{sourceMaterial.titleZh}）
                  </Link>
                ) : (
                  "手动添加"
                )}
                {" · "}加入于 {vocabulary.firstSeenAt.toLocaleDateString("zh-CN", { timeZone })}
              </p>
            </CardContent>
          </Card>

          {vocabulary.status === "difficult" ? (
            <div className="flex gap-3 rounded-2xl bg-coral-soft p-4 text-sm text-coral-ink">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>这个词已经忘了好几次。可以换个方式记：大声读例句、自己造一个句子，或者先暂停难度高的卡片，只保留“英 → 义”。</p>
            </div>
          ) : null}

          <Card>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-sm">
                  <span>被动识别（看得懂）</span>
                  <span className="tabular-nums text-muted">{Math.round(vocabulary.receptiveMastery * 100)}%</span>
                </div>
                <ProgressBar value={vocabulary.receptiveMastery} label="被动识别稳定度" />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-sm">
                  <span>主动回忆（用得出）</span>
                  <span className="tabular-nums text-muted">{Math.round(vocabulary.productiveMastery * 100)}%</span>
                </div>
                <ProgressBar value={vocabulary.productiveMastery} label="主动回忆稳定度" tone="mint" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <section>
            <SectionHeader title="复习卡片" description="每种卡片练的是不同的能力，按需添加。" />
            <Card>
              <ul className="divide-y divide-border">
                {cards.map((card) => (
                  <li key={card.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-medium text-ink">
                        {CARD_TYPE_INFO[card.cardType].label}
                        <span className="ml-2 text-xs font-normal text-muted">{CARD_TYPE_INFO[card.cardType].description}</span>
                      </span>
                      <span className="text-xs text-muted">
                        {card.suspendedAt
                          ? "已暂停"
                          : `${STATE_LABELS[card.state] ?? ""} · 下次 ${describeDueIn(card.dueAt, now)} · 复习 ${card.reps} 次 · 遗忘 ${card.lapses} 次`}
                      </span>
                    </div>
                    {card.difficultAt ? <Badge tone="coral" size="sm">困难</Badge> : null}
                    <SuspendCardButton cardId={card.id} entryId={entry.id} suspended={card.suspendedAt !== null} />
                  </li>
                ))}
              </ul>
            </Card>
            {missing.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted">添加练习：</span>
                {missing.map((type) => (
                  <AddCardTypeButton key={type} entryId={entry.id} cardType={type} />
                ))}
              </div>
            ) : null}
          </section>

          <section>
            <SectionHeader title="复习记录" />
            {history.length === 0 ? (
              <p className="text-sm text-muted">还没有复习过。</p>
            ) : (
              <Card>
                <ul className="divide-y divide-border text-sm">
                  {history.map((h, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-4 py-2">
                      <span className="text-muted tabular-nums">{h.reviewedAt.toLocaleString("zh-CN", { hour12: false, timeZone })}</span>
                      <span className="text-ink">{CARD_TYPE_INFO[h.cardType].label}</span>
                      <span className="font-medium text-ink">{RATING_LABELS[h.rating as Grade].zh}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
