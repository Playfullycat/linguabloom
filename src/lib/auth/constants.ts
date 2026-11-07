/**
 * Dependency-free auth constants, safe to import from the Proxy and the client.
 */
export const AUTH_COOKIE_PREFIX = "lb";

/** Routes reachable without a session. Everything else requires the owner. */
export const PUBLIC_PATHS = ["/login", "/setup"] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Query flag set after a successful password change (Settings shows a confirmation). */
export const PASSWORD_CHANGED_PARAM = "passwordChanged";
