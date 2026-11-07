import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth/session";
import { logoutAction } from "@/modules/auth/actions";

/** Signed-in user + sign out, in the sidebar footer. Reads the session (needs Suspense). */
export async function SidebarAccount() {
  const user = await getCurrentUser();
  if (!user) return null;
  const initial = (user.name.trim()[0] ?? "?").toUpperCase();

  return (
    <div className="flex items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5 sidebar-collapsed:flex-col sidebar-collapsed:px-0">
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary-ink"
      >
        {initial}
      </span>
      <div className="flex min-w-0 flex-1 flex-col sidebar-collapsed:sr-only">
        <span className="truncate text-sm font-medium text-ink">{user.name}</span>
        <span className="truncate text-xs text-muted">{user.email}</span>
      </div>
      <form action={logoutAction}>
        <Button type="submit" variant="ghost" size="icon-sm" className="text-muted hover:text-ink" title="退出登录">
          <LogOut aria-hidden="true" />
          <span className="sr-only">退出登录</span>
        </Button>
      </form>
    </div>
  );
}

export function SidebarAccountSkeleton() {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5 sidebar-collapsed:justify-center">
      <Skeleton className="size-8 rounded-full" />
      <div className="flex flex-1 flex-col gap-1.5 sidebar-collapsed:hidden">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-28" />
      </div>
    </div>
  );
}
