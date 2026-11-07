import { AppShell } from "@/components/layout/app-shell";

// Phase 0.2: this group becomes the authenticated area (owner session required).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
