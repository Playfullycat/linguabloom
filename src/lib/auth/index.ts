import "server-only";

import { getDb } from "@/db";
import { getEnv } from "@/lib/config/env";

import { createAuth, type Auth } from "./create-auth";

export { AUTH_COOKIE_PREFIX, type Auth } from "./create-auth";

const globalForAuth = globalThis as unknown as { __linguabloomAuth?: Auth };

/** Shared Better Auth instance, created on first use (not at build time). */
export function getAuth(): Auth {
  globalForAuth.__linguabloomAuth ??= createAuth({ db: getDb(), env: getEnv() });
  return globalForAuth.__linguabloomAuth;
}
