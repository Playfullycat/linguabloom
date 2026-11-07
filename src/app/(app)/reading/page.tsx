import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { MaterialList } from "@/components/materials/material-list";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { listMaterials } from "@/modules/materials/services/materials";

export const metadata: Metadata = { title: "Reading" };

export default function ReadingPage() {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <BookOpen className="size-4" aria-hidden="true" />
            <span lang="en">Learn</span> · 学习
          </span>
        }
        title="Reading"
        titleZh="阅读"
        description="略高于当前水平、但能读懂的分级阅读。点任意单词查义，自己决定要不要加入词汇库。"
      />
      <Suspense fallback={<LoadingSkeleton label="正在加载材料…" />}>
        <ReadingList />
      </Suspense>
    </>
  );
}

async function ReadingList() {
  const user = await requireOwner();
  const { materials, learner } = await listMaterials(getDb(), user.id, "reading");
  return <MaterialList materials={materials} learnerLabel={learner.label} basis={learner.basis} />;
}
