import { Suspense, type ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { OfflineSupport } from "@/components/layout/offline-support";
import { SidebarAccount, SidebarAccountSkeleton } from "@/components/layout/sidebar-account";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { requireOwner } from "@/lib/auth/session";

/**
 * Signed-in area. The shell (navigation) is static; page content renders
 * only after the owner session is verified. Pages, actions and data access
 * still check the session themselves — a layout is not a security boundary.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      account={
        <Suspense fallback={<SidebarAccountSkeleton />}>
          <SidebarAccount />
        </Suspense>
      }
    >
      <OfflineSupport />
      <Suspense fallback={<LoadingSkeleton />}>
        <OwnerGate>{children}</OwnerGate>
      </Suspense>
    </AppShell>
  );
}

async function OwnerGate({ children }: { children: ReactNode }) {
  await requireOwner();
  return children;
}
