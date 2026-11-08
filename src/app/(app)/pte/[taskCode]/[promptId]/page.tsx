import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { PracticePlayer } from "@/components/pte/practice-player";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { aiStatus } from "@/modules/ai/provider";
import { speechAvailable } from "@/modules/audio/tts-cache";
import { PteNotFoundError, getCurrentVersion, getPracticeItem, getTaskType, listPrompts } from "@/modules/pte/services/pte";

export const metadata: Metadata = { title: "PTE practice" };

export default function PtePracticePage({ params }: PageProps<"/pte/[taskCode]/[promptId]">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在准备题目…" />}>
      <PracticeLoader params={params} />
    </Suspense>
  );
}

async function PracticeLoader({ params }: Pick<PageProps<"/pte/[taskCode]/[promptId]">, "params">) {
  const { taskCode, promptId } = await params;
  const user = await requireOwner();
  const db = getDb();
  const item = await getPracticeItem(db, promptId).catch((e: unknown) => {
    if (e instanceof PteNotFoundError) return null;
    throw e;
  });
  if (!item || item.taskCode !== taskCode) notFound();
  const version = await getCurrentVersion(db);
  const [type, prompts] = await Promise.all([getTaskType(db, version.id, taskCode), listPrompts(db, user.id, taskCode)]);
  const index = prompts.findIndex((p) => p.id === promptId);
  const next = prompts[index + 1] ?? null;
  const status = aiStatus();
  const audioSource = !speechAvailable() ? "browser" : status.available && status.simulated ? "simulated" : "provider";
  const rule = type.scoring.method === "ai_traits" ? "词数由程序检查，其余是 AI 辅助反馈" : (type.scoring.rule_zh ?? type.scoring.official_zh);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/pte/${taskCode}`} className="inline-flex items-center gap-1.5 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            {type.nameZh}
          </Link>
        }
        title={item.titleZh}
        titleZh={type.nameEn}
        description={type.descriptionZh}
      />
      <Card className="max-w-3xl">
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-wrap gap-1.5">
            <Badge size="sm">难度 {item.difficulty}</Badge>
            <Badge size="sm" tone="outline">
              原创练习题 · {version.labelZh.split("（")[0]}
            </Badge>
          </div>
          {/* Keyed by prompt: going to the next item starts fresh. */}
          <PracticePlayer key={item.promptId} item={item} scoringRule={rule} audioSource={audioSource} nextHref={next ? `/pte/${taskCode}/${next.id}` : null} />
        </CardContent>
      </Card>
    </>
  );
}
