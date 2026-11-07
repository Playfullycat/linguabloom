import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { ReadingRoom } from "@/components/materials/reading-room";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { MaterialNotFoundError, getMaterialForReader } from "@/modules/materials/services/materials";

export const metadata: Metadata = { title: "Reading" };

export default function ReadingMaterialPage({ params }: PageProps<"/reading/[contentId]">) {
  return (
    <Suspense fallback={<LoadingSkeleton label="正在准备阅读…" />}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: Pick<PageProps<"/reading/[contentId]">, "params">) {
  const { contentId } = await params;
  const user = await requireOwner();
  const material = await getMaterialForReader(getDb(), user.id, decodeURIComponent(contentId)).catch((error: unknown) => {
    if (error instanceof MaterialNotFoundError) return null;
    throw error;
  });
  if (!material || material.type !== "reading") notFound();
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/reading" className="inline-flex items-center gap-1.5 hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span lang="en">Reading</span> · 阅读
          </Link>
        }
        title={material.titleEn}
        titleZh={material.titleZh}
        description={material.summaryZh}
      />
      <ReadingRoom key={material.id} material={material} />
    </>
  );
}
