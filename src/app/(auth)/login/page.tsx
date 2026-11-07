import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { AuthCard, AuthCardSkeleton } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getSetupStatus } from "@/modules/auth/services/owner-setup";

export const metadata: Metadata = { title: "登录" };

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <LoginGate />
    </Suspense>
  );
}

async function LoginGate() {
  await connection();
  const { ownerExists } = await getSetupStatus(getDb());
  if (!ownerExists) redirect("/setup");
  if (await getCurrentUser()) redirect("/today");

  return (
    <AuthCard title="Welcome back" description="登录后继续你的学习。">
      <LoginForm />
    </AuthCard>
  );
}
