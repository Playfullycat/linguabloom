import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { ListeningStudio } from "@/components/materials/listening-studio";
import { speechAvailable } from "@/modules/audio/tts-cache";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { aiStatus } from "@/modules/ai/provider";
import { MaterialNotFoundError, getMaterialForReader } from "@/modules/materials/services/materials";

export const metadata: Metadata = { title: "Listening" };

export default function ListeningMaterialPage({ params }: PageProps<"/listening/[contentId]">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在准备听力…" />}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: Pick<PageProps<"/listening/[contentId]">, "params">) {
  const { contentId } = await params;
  const user = await requireOwner();
  const material = await getMaterialForReader(getDb(), user.id, decodeURIComponent(contentId)).catch((error: unknown) => {
    if (error instanceof MaterialNotFoundError) return null;
    throw error;
  });
  if (!material || material.type !== "listening") notFound();
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/listening" className="inline-flex items-center gap-1.5 hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span lang="en">Listening</span> · 听力
          </Link>
        }
        title={material.titleEn}
        titleZh={material.titleZh}
        description={material.summaryZh}
      />
      <ListeningStudio key={material.id} material={material} aiAvailable={aiStatus().available} ttsAvailable={speechAvailable()} />
    </>
  );
}
