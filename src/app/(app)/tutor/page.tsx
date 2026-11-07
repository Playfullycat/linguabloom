import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { TutorChat } from "@/components/tutor/tutor-chat";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { AI_STATUS_LABELS, aiStatus } from "@/modules/ai/provider";
import { listTutorSessions } from "@/modules/ai/services/tutor";
import { buildTutorContext } from "@/modules/ai/tutor/context";
import { ROLEPLAY_SCENES, TUTOR_MODES, TUTOR_MODE_INFO, type TutorMode } from "@/modules/ai/tutor/prompts";
import { getLearnerSettings } from "@/modules/learner/services/profile";
import { MaterialNotFoundError, getMaterialForReader } from "@/modules/materials/services/materials";

export const metadata: Metadata = { title: "AI Tutor" };

export default function TutorPage({ searchParams }: PageProps<"/tutor">) {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="size-4" aria-hidden="true" />
            <span lang="en">AI Tutor</span> · AI 辅导
          </span>
        }
        title="AI Tutor"
        titleZh="AI 辅导"
        description="按你各项技能的水平调整说话方式的英语老师：讲解、练习、对话、角色扮演、纠错，也能陪你读当前的材料。"
      />
      <Suspense fallback={<LoadingSkeleton label="正在准备…" />}>
        <TutorLoader searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function TutorLoader({ searchParams }: Pick<PageProps<"/tutor">, "searchParams">) {
  const params = await searchParams;
  const user = await requireOwner();
  const status = aiStatus();
  if (!status.available) {
    return (
      <Card className="max-w-2xl">
        <CardContent className="flex flex-col gap-3 pt-6 text-sm">
          <p className="text-base font-semibold text-ink">AI 还没有启用</p>
          <p className="text-muted">当前状态：{AI_STATUS_LABELS[status.reason]}。课程、复习、阅读、听力、语法和错误本都不需要 AI，照常可用。</p>
          <p className="text-muted">
            启用方法：在服务器的 <code>.env</code> 里设置 <code>AI_ENABLED=true</code>、<code>AI_API_KEY</code> 和 <code>AI_TEXT_MODEL</code>，然后重启。想先试试界面，可以用 <code>AI_PROVIDER=mock</code>（本地模拟，不联网、不花钱）。
          </p>
          <p className="text-muted">密钥只在服务器上使用，不会发到浏览器。</p>
        </CardContent>
      </Card>
    );
  }

  const db = getDb();
  const requested = typeof params.mode === "string" && (TUTOR_MODES as readonly string[]).includes(params.mode) ? (params.mode as TutorMode) : "explain";
  const contentId = typeof params.content === "string" ? params.content : null;
  const seq = typeof params.seq === "string" && /^\d+$/.test(params.seq) ? Number(params.seq) : null;
  const m = contentId
    ? await getMaterialForReader(db, user.id, contentId).catch((e: unknown) => {
        if (e instanceof MaterialNotFoundError) return null;
        throw e;
      })
    : null;
  const [{ profile, preferences }, sessions, ctx] = await Promise.all([getLearnerSettings(db, user.id), listTutorSessions(db, user.id), buildTutorContext(db, user.id, "explain")]);

  return (
    <TutorChat
      modes={TUTOR_MODES.map((value) => ({ value, ...TUTOR_MODE_INFO[value] }))}
      scenes={ROLEPLAY_SCENES.map((s) => ({ id: s.id, title: s.title }))}
      initialMode={m ? (m.type === "listening" ? "listening_coach" : "reading_coach") : requested}
      material={m ? { contentId: m.id, seq, title: m.titleEn, type: m.type } : null}
      level={ctx.level}
      levelBasis={ctx.levelBasis}
      simulated={status.simulated}
      saveConversations={preferences.saveAiConversations}
      sessions={sessions.map((s) => ({ ...s, startedAt: s.startedAt.toLocaleDateString("zh-CN", { timeZone: profile.timezone }) }))}
    />
  );
}
