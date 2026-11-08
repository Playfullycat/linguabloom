/**
 * Dependency-free auth constants, safe to import from the Proxy and the client.
 */
export const AUTH_COOKIE_PREFIX = "lb";

/**
 * Routes reachable without a session. Everything else requires the owner.
 * The offline shell, service worker, manifest and app icons hold no personal data
 * (offline review data lives only in the browser) and must load before sign-in checks.
 */
export const PUBLIC_PATHS = ["/login", "/setup", "/offline", "/sw.js", "/manifest.webmanifest", "/icons"] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Query flag set after a successful password change (Settings shows a confirmation). */
export const PASSWORD_CHANGED_PARAM = "passwordChanged";
