"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  applyThemePreference,
  readThemePreference,
  subscribeUiPrefs,
  type ThemePreference,
} from "@/lib/ui-prefs";
import { cn } from "@/lib/utils";

const themeOptions = [
  { value: "light", label: <><Sun aria-hidden="true" />浅色</> },
  { value: "dark", label: <><Moon aria-hidden="true" />深色</> },
  { value: "system", label: <><Monitor aria-hidden="true" />跟随系统</> },
] as const satisfies readonly { value: ThemePreference; label: ReactNode }[];

/**
 * Light / dark / system choice for Settings → Appearance. The stored choice
 * only exists in the browser, so the server renders no selection (null)
 * instead of guessing; the real value appears on hydration.
 */
export function ThemePreferenceControl() {
  const preference = useSyncExternalStore<ThemePreference | null>(subscribeUiPrefs, readThemePreference, () => null);
  return (
    <SegmentedControl
      ariaLabel="界面主题"
      value={preference}
      onValueChange={applyThemePreference}
      options={themeOptions}
    />
  );
}

/**
 * One-click light/dark switch for the app chrome. The icon is driven by the
 * `dark:` variant on <html>, so it is correct before hydration (no flash).
 */
export function ThemeQuickToggle({ className }: { className?: string }) {
  const toggle = () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    applyThemePreference(isDark ? "light" : "dark");
  };
  return (
    <Button variant="ghost" size="icon-sm" onClick={toggle} className={cn("text-muted hover:text-ink", className)}>
      <Moon className="dark:hidden" aria-hidden="true" />
      <Sun className="hidden dark:block" aria-hidden="true" />
      <span className="sr-only dark:hidden">切换到深色模式</span>
      <span className="sr-only hidden dark:inline">切换到浅色模式</span>
    </Button>
  );
}
