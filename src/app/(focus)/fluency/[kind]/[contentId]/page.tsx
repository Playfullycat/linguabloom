import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { FluencyPractice } from "@/components/fluency/fluency-practice";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { isFluencyKind } from "@/modules/fluency/domain/fluency";
import { MaterialNotFoundError, getFluencyText } from "@/modules/fluency/services/fluency";

export const metadata: Metadata = { title: "Fluency practice" };

export default function FluencyPracticePage({ params }: PageProps<"/fluency/[kind]/[contentId]">) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-3xl px-4 py-10">
          <LoadingSkeleton label="正在打开练习…" />
        </div>
      }
    >
      <PracticeLoader params={params} />
    </Suspense>
  );
}

async function PracticeLoader({ params }: Pick<PageProps<"/fluency/[kind]/[contentId]">, "params">) {
  const { kind, contentId } = await params;
  if (!isFluencyKind(kind)) notFound();
  const user = await requireOwner();
  const text = await getFluencyText(getDb(), user.id, decodeURIComponent(contentId)).catch((error: unknown) => {
    if (error instanceof MaterialNotFoundError) return null;
    throw error;
  });
  if (!text || (kind === "speed_reading" && text.questions.length === 0)) notFound();
  return <FluencyPractice key={`${kind}:${text.id}`} kind={kind} text={text} />;
}
