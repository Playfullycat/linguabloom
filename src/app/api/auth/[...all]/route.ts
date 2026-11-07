import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";

/**
 * Better Auth HTTP endpoints (/api/auth/*). The app itself uses Server
 * Actions; this handler serves session/sign-out requests and keeps Better
 * Auth's built-in rate limiting and origin checks in front of them.
 * Sign-up is disabled in the auth config.
 */
export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
