import { KeyRound, LogOut, MonitorSmartphone } from "lucide-react";

import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PASSWORD_CHANGED_PARAM } from "@/lib/auth/constants";
import { requireOwner } from "@/lib/auth/session";
import { logoutAction, signOutEverywhereAction } from "@/modules/auth/actions";

/** Settings → Account. Reads the session, so render inside <Suspense>. */
export async function AccountSettings({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireOwner();
  const passwordChanged = (await searchParams)[PASSWORD_CHANGED_PARAM] === "1";

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-ink">
          <KeyRound className="size-5" aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1">
          <CardTitle>
            账户与安全 <span lang="en" className="ml-1 text-sm font-normal text-muted">Account</span>
          </CardTitle>
          <CardDescription>
            已登录：<span className="font-medium text-ink">{user.name}</span>（{user.email}）
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-8">
        <section aria-labelledby="change-password-title" className="flex flex-col gap-3">
          <h3 id="change-password-title" className="text-sm font-semibold text-ink">
            修改密码
          </h3>
          <ChangePasswordForm passwordChanged={passwordChanged} />
        </section>

        <section aria-labelledby="sessions-title" className="flex flex-col gap-3 border-t border-border pt-6">
          <h3 id="sessions-title" className="text-sm font-semibold text-ink">
            登录状态
          </h3>
          <p className="text-sm text-muted">如果在别的设备上登录过又不放心，可以一键退出所有设备。</p>
          <div className="flex flex-wrap gap-2">
            <form action={logoutAction}>
              <Button type="submit" variant="outline">
                <LogOut aria-hidden="true" />
                退出登录
              </Button>
            </form>
            <ConfirmDialog
              trigger={
                <Button variant="outline">
                  <MonitorSmartphone aria-hidden="true" />
                  退出所有设备
                </Button>
              }
              title="退出所有设备？"
              description="所有设备上的登录（包括当前这台）都会立即失效，你需要重新登录。学习数据不受影响。"
              confirmLabel="全部退出"
              action={signOutEverywhereAction}
            />
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

export function AccountSettingsSkeleton() {
  return (
    <Card role="status" aria-live="polite">
      <span className="sr-only">正在加载账户信息…</span>
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-11 w-full max-w-md" />
        <Skeleton className="h-11 w-full max-w-md" />
      </CardContent>
    </Card>
  );
}
