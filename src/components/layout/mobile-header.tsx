import Link from "next/link";

import { BrandMark, BrandWordmark } from "@/components/layout/brand-mark";
import { ThemeQuickToggle } from "@/components/layout/theme-controls";
import { Button } from "@/components/ui/button";
import { library, settings } from "@/lib/config/navigation";

/** Compact top bar for < lg screens. */
export function MobileHeader() {
  const LibraryIcon = library.icon;
  const SettingsIcon = settings.icon;
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-surface/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md lg:hidden">
      <Link href="/today" className="flex items-center gap-2 rounded-xl">
        <BrandMark className="size-7" />
        <BrandWordmark />
      </Link>
      <div className="flex items-center gap-0.5">
        <ThemeQuickToggle />
        <Button asChild variant="ghost" size="icon-sm" className="text-muted hover:text-ink">
          <Link href={library.href}>
            <LibraryIcon aria-hidden="true" />
            <span className="sr-only">{library.labelZh}</span>
          </Link>
        </Button>
        <Button asChild variant="ghost" size="icon-sm" className="text-muted hover:text-ink">
          <Link href={settings.href}>
            <SettingsIcon aria-hidden="true" />
            <span className="sr-only">{settings.labelZh}</span>
          </Link>
        </Button>
      </div>
    </header>
  );
}
