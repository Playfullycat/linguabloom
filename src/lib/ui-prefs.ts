/**
 * Non-sensitive UI preferences (theme, sidebar collapsed) kept in localStorage.
 *
 * The spec allows localStorage for UI preferences only — never for learning
 * data. Once the learner is signed in, the theme preference is also mirrored
 * to `study_preferences` in PostgreSQL (Phase 1).
 *
 * To avoid a flash of the wrong theme, `UI_PREFS_INLINE_SCRIPT` runs in
 * <head> before first paint and sets `data-theme` / `data-sidebar` on <html>
 * (Next.js "preventing flash before hydration" guide). React components read
 * the same keys through `readThemePreference()` etc.
 */

export const THEME_STORAGE_KEY = "lb-theme";
export const SIDEBAR_STORAGE_KEY = "lb-sidebar";
export const UI_PREFS_EVENT = "lb-ui-prefs-change";

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

export type SidebarState = "expanded" | "collapsed";

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/**
 * Runs synchronously in <head>. Must stay dependency-free ES5 and must never
 * throw (private mode / disabled storage). Keep the logic in sync with
 * `resolveTheme` — covered by `ui-prefs.test.ts`.
 */
export const UI_PREFS_INLINE_SCRIPT = `(function(){
var d=document.documentElement;
function pref(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");return t==="light"||t==="dark"?t:"system"}catch(e){return "system"}}
function apply(){var p=pref();var dark=p==="dark"||(p==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);d.setAttribute("data-theme",dark?"dark":"light")}
apply();
try{if(localStorage.getItem("${SIDEBAR_STORAGE_KEY}")==="collapsed")d.setAttribute("data-sidebar","collapsed")}catch(e){}
try{var mq=window.matchMedia("(prefers-color-scheme: dark)");var on=function(){if(pref()==="system")apply()};mq.addEventListener?mq.addEventListener("change",on):mq.addListener(on)}catch(e){}
})();`;

// ---- Client-side helpers (call from Client Components only) ----

function notify() {
  window.dispatchEvent(new Event(UI_PREFS_EVENT));
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: preference applies to this page view only.
  }
}

export function readThemePreference(): ThemePreference {
  const stored = safeGet(THEME_STORAGE_KEY);
  return isThemePreference(stored) ? stored : "system";
}

export function applyThemePreference(preference: ThemePreference) {
  safeSet(THEME_STORAGE_KEY, preference);
  const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  document.documentElement.setAttribute("data-theme", resolveTheme(preference, systemDark));
  notify();
}

export function readSidebarState(): SidebarState {
  return document.documentElement.getAttribute("data-sidebar") === "collapsed" ? "collapsed" : "expanded";
}

export function applySidebarState(state: SidebarState) {
  safeSet(SIDEBAR_STORAGE_KEY, state);
  if (state === "collapsed") {
    document.documentElement.setAttribute("data-sidebar", "collapsed");
  } else {
    document.documentElement.removeAttribute("data-sidebar");
  }
  notify();
}

/** Subscribe for `useSyncExternalStore`. Also reacts to changes from other tabs. */
export function subscribeUiPrefs(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) {
      const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
      document.documentElement.setAttribute("data-theme", resolveTheme(readThemePreference(), systemDark));
      callback();
    } else if (event.key === SIDEBAR_STORAGE_KEY) {
      if (event.newValue === "collapsed") document.documentElement.setAttribute("data-sidebar", "collapsed");
      else document.documentElement.removeAttribute("data-sidebar");
      callback();
    }
  };
  window.addEventListener(UI_PREFS_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(UI_PREFS_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}
