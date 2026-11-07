import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { AuthCard, AuthCardSkeleton } from "@/components/auth/auth-card";
import { SetupForm } from "@/components/auth/setup-form";
import { getDb } from "@/db";
import { getEnv } from "@/lib/config/env";
import { getSetupStatus } from "@/modules/auth/services/owner-setup";

export const metadata: Metadata = { title: "初始化" };

export default function SetupPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <SetupGate />
    </Suspense>
  );
}

async function SetupGate() {
  await connection(); // request-time only: never query the database during build
  const { ownerExists } = await getSetupStatus(getDb());
  if (ownerExists) redirect("/login");

  const env = getEnv();
  if (!env.OWNER_SETUP_ENABLED) {
    return (
      <AuthCard
        title="初始化已关闭"
        description="服务器设置了 OWNER_SETUP_ENABLED=false。需要创建账户时，请把它改为 true 并重启应用。"
      >
        <p className="text-sm text-muted">这是为了防止在你准备好之前，其他人抢先完成初始化。</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="欢迎使用 LinguaBloom"
      description="先创建你的账户。这是一个只属于你的私人学习空间：只有这一个账户，之后不开放注册。"
    >
      <SetupForm requireToken={Boolean(env.OWNER_SETUP_TOKEN)} />
    </AuthCard>
  );
}
