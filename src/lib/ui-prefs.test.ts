import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SIDEBAR_STORAGE_KEY,
  THEME_STORAGE_KEY,
  UI_PREFS_INLINE_SCRIPT,
  applySidebarState,
  applyThemePreference,
  readThemePreference,
  resolveTheme,
} from "./ui-prefs";

function mockSystemDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: dark && query.includes("dark"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
}

function runInlineScript() {
  // Same code the browser runs in <head> before first paint.
  new Function(UI_PREFS_INLINE_SCRIPT)();
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-sidebar");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveTheme", () => {
  it("returns explicit choices unchanged", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the OS for 'system'", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("inline pre-paint script", () => {
  it("defaults to the system theme when nothing is stored", () => {
    mockSystemDark(true);
    runInlineScript();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("applies a stored explicit theme regardless of the OS", () => {
    mockSystemDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    runInlineScript();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("ignores unknown stored values", () => {
    mockSystemDark(false);
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    runInlineScript();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("restores the collapsed sidebar", () => {
    mockSystemDark(false);
    localStorage.setItem(SIDEBAR_STORAGE_KEY, "collapsed");
    runInlineScript();
    expect(document.documentElement.getAttribute("data-sidebar")).toBe("collapsed");
  });

  it("never throws when storage is unavailable", () => {
    mockSystemDark(false);
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => runInlineScript()).not.toThrow();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    getItem.mockRestore();
  });
});

describe("client helpers", () => {
  it("persists and applies a theme preference", () => {
    mockSystemDark(false);
    applyThemePreference("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(readThemePreference()).toBe("dark");
  });

  it("toggles the sidebar attribute", () => {
    applySidebarState("collapsed");
    expect(document.documentElement.getAttribute("data-sidebar")).toBe("collapsed");
    applySidebarState("expanded");
    expect(document.documentElement.hasAttribute("data-sidebar")).toBe(false);
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("expanded");
  });
});
