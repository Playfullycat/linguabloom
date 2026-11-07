import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { LessonPlayer } from "@/components/lesson/lesson-player";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getLessonForPlayer } from "@/modules/curriculum/services/queries";

export const metadata: Metadata = { title: "Lesson" };

export default function LessonPage({ params }: PageProps<"/lesson/[lessonId]">) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-3xl px-4 py-10">
          <LoadingSkeleton label="正在打开课程…" />
        </div>
      }
    >
      <LessonLoader params={params} />
    </Suspense>
  );
}

async function LessonLoader({ params }: Pick<PageProps<"/lesson/[lessonId]">, "params">) {
  const { lessonId } = await params;
  const user = await requireOwner();
  const lesson = await getLessonForPlayer(getDb(), user.id, lessonId);
  if (!lesson) notFound();
  // Keyed by lesson so navigating to the next lesson starts with fresh state.
  return <LessonPlayer key={lesson.id} lesson={lesson} />;
}
