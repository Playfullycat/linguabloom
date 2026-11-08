import { Suspense, type ReactNode } from "react";

import { LoadingSkeleton } from "@/components/ui/skeleton";
import { requireOwner } from "@/lib/auth/session";

/**
 * Distraction-free area for learning (lesson player): no sidebar or bottom
 * navigation, one main task per page (spec §2.7). Owner session required.
 */
export default function FocusLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-3xl px-4 py-10">
          <LoadingSkeleton />
        </div>
      }
    >
      <main>
        <OwnerGate>{children}</OwnerGate>
      </main>
    </Suspense>
  );
}

async function OwnerGate({ children }: { children: ReactNode }) {
  await requireOwner();
  return children;
}
