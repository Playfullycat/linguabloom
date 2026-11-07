import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";

import type { Database } from "@/db/connection";
import { accounts, sessions, users, verifications } from "@/db/schema";
import { isHttpsApp, type Env } from "@/lib/config/env";

import { AUTH_COOKIE_PREFIX } from "./constants";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, hashPassword, verifyPassword } from "./password";

export { AUTH_COOKIE_PREFIX };

const DAY = 60 * 60 * 24;

/**
 * Better Auth configuration. Pure factory (no globals) so integration tests
 * can build an instance against the test database.
 *
 * `withNextCookies` must stay on inside Next.js; tests outside a Next request
 * turn it off because the plugin writes cookies through `next/headers`.
 */
export function createAuth({ db, env, withNextCookies = true }: { db: Database; env: Env; withNextCookies?: boolean }) {
  return betterAuth({
    appName: "LinguaBloom",
    baseURL: env.APP_URL,
    secret: env.APP_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    emailAndPassword: {
      enabled: true,
      // Public registration is closed (spec §7.4). The single owner is created
      // by the first-run setup service, never through the sign-up endpoint.
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      password: { hash: hashPassword, verify: verifyPassword },
      revokeSessionsOnPasswordReset: true,
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "owner", input: false },
      },
    },
    session: {
      // Database sessions: revocable, and "sign out everywhere" really works.
      expiresIn: 30 * DAY,
      updateAge: DAY,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
    },
    advanced: {
      database: { generateId: "uuid" },
      cookiePrefix: AUTH_COOKIE_PREFIX,
      // HttpOnly + SameSite=Lax are Better Auth defaults; Secure on HTTPS.
      useSecureCookies: isHttpsApp(env),
    },
    // Private, self-hosted app: no telemetry.
    telemetry: { enabled: false },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, session.userId));
          },
        },
      },
    },
    // Must stay last: lets auth.api calls in Server Actions set cookies.
    plugins: withNextCookies ? [nextCookies()] : [],
  });
}

export type Auth = ReturnType<typeof createAuth>;
