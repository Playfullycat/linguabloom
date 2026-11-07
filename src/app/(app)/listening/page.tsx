import { Headphones } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { MaterialList } from "@/components/materials/material-list";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { listMaterials } from "@/modules/materials/services/materials";

export const metadata: Metadata = { title: "Listening" };

export default function ListeningPage() {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Headphones className="size-4" aria-hidden="true" />
            <span lang="en">Learn</span> · 学习
          </span>
        }
        title="Listening"
        titleZh="听力"
        description="先听后看：逐句播放、单句循环、变速，字幕可以隐藏、英文、中文辅助或双语。"
      />
      <Suspense fallback={<LoadingSkeleton label="正在加载材料…" />}>
        <ListeningList />
      </Suspense>
    </>
  );
}

async function ListeningList() {
  const user = await requireOwner();
  const { materials, learner } = await listMaterials(getDb(), user.id, "listening");
  return <MaterialList materials={materials} learnerLabel={learner.label} basis={learner.basis} />;
}
