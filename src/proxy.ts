import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { AUTH_COOKIE_PREFIX, isPublicPath } from "@/lib/auth/constants";

/**
 * Optimistic gate: visitors without a session cookie are sent to /login
 * before any page renders. This only checks that a cookie exists; the real
 * check (database session) happens in pages, actions and route handlers.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // "/" decides between setup and login itself; public pages are open.
  if (pathname === "/" || isPublicPath(pathname)) return NextResponse.next();

  if (!getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX })) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Skip API routes (they authenticate themselves), Next internals and static files.
  matcher: ["/((?!api/|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
