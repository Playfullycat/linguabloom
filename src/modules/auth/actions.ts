"use server";

import { timingSafeEqual } from "node:crypto";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { PASSWORD_CHANGED_PARAM } from "@/lib/auth/constants";
import { requireOwner } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { createFailureLimiter } from "@/lib/security/failure-limiter";

import {
  changePasswordSchema,
  fieldErrorsFrom,
  loginSchema,
  setupSchema,
  type FormState,
} from "./schemas";
import { createOwner, getSetupStatus } from "./services/owner-setup";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Per-process limiters (single-instance app). Keys never contain passwords.
const globalForLimiters = globalThis as unknown as {
  __lbLoginByIp?: ReturnType<typeof createFailureLimiter>;
  __lbLoginByEmail?: ReturnType<typeof createFailureLimiter>;
  __lbPasswordChange?: ReturnType<typeof createFailureLimiter>;
};
const loginByIp = (globalForLimiters.__lbLoginByIp ??= createFailureLimiter({ maxFailures: 20, windowMs: FIFTEEN_MINUTES }));
const loginByEmail = (globalForLimiters.__lbLoginByEmail ??= createFailureLimiter({ maxFailures: 8, windowMs: FIFTEEN_MINUTES }));
const passwordChange = (globalForLimiters.__lbPasswordChange ??= createFailureLimiter({ maxFailures: 5, windowMs: FIFTEEN_MINUTES }));

function minutesFrom(ms: number) {
  return Math.max(1, Math.ceil(ms / 60_000));
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

function tokensMatch(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- setup ----

export async function setupOwnerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const env = getEnv();
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const values = { name: raw.name ?? "", email: raw.email ?? "" };

  if (!env.OWNER_SETUP_ENABLED) {
    return { status: "error", message: "初始化已被管理员关闭（OWNER_SETUP_ENABLED=false）。", values };
  }

  const parsed = setupSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: "请检查标出的字段。", fieldErrors: fieldErrorsFrom(parsed.error), values };
  }

  if (env.OWNER_SETUP_TOKEN && !tokensMatch(parsed.data.setupToken, env.OWNER_SETUP_TOKEN)) {
    return { status: "error", fieldErrors: { setupToken: ["初始化口令不正确"] }, values };
  }

  const db = getDb();
  const auth = getAuth();
  const result = await createOwner({ db, auth }, parsed.data);
  if (!result.ok) {
    // Someone completed setup first (or is doing it right now).
    redirect("/login");
  }

  await auth.api.signInEmail({
    body: { email: parsed.data.email, password: parsed.data.password },
    headers: await headers(),
  });
  redirect("/today");
}

// ---------------------------------------------------------------- login ----

const GENERIC_LOGIN_ERROR = "邮箱或密码不正确。";

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const values = { email: raw.email ?? "" };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };
  }

  const ipKey = `ip:${await clientIp()}`;
  const emailKey = `email:${parsed.data.email}`;
  const blocked = [loginByIp.check(ipKey), loginByEmail.check(emailKey)].find((c) => c.blocked);
  if (blocked) {
    return {
      status: "error",
      message: `尝试次数太多了，请 ${minutesFrom(blocked.retryAfterMs)} 分钟后再试。`,
      values,
    };
  }

  const { ownerExists } = await getSetupStatus(getDb());
  if (!ownerExists) redirect("/setup");

  try {
    await getAuth().api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) {
      loginByIp.recordFailure(ipKey);
      loginByEmail.recordFailure(emailKey);
      // Same message for unknown email and wrong password (no account enumeration).
      return { status: "error", message: GENERIC_LOGIN_ERROR, values };
    }
    throw error;
  }

  loginByEmail.reset(emailKey);
  redirect("/today");
}

// --------------------------------------------------------------- logout ----

export async function logoutAction(): Promise<void> {
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch {
    // Already signed out / session expired: nothing to revoke.
  }
  redirect("/login");
}

/** Revoke every session of the owner, including this one (spec §7.4). */
export async function signOutEverywhereAction(): Promise<void> {
  await requireOwner();
  const auth = getAuth();
  const requestHeaders = await headers();
  await auth.api.revokeSessions({ headers: requestHeaders });
  try {
    // Clears this browser's cookie; the session row is already gone.
    await auth.api.signOut({ headers: requestHeaders });
  } catch {
    // Expected when the session was revoked above.
  }
  redirect("/login");
}

// ------------------------------------------------------ change password ----

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireOwner();
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const key = `user:${user.id}`;
  const blocked = passwordChange.check(key);
  if (blocked.blocked) {
    return { status: "error", message: `尝试次数太多了，请 ${minutesFrom(blocked.retryAfterMs)} 分钟后再试。` };
  }

  try {
    await getAuth().api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) {
      passwordChange.recordFailure(key);
      return { status: "error", fieldErrors: { currentPassword: ["当前密码不正确"] } };
    }
    throw error;
  }

  passwordChange.reset(key);
  // Better Auth replaced this device's session cookie. Re-rendering inside this
  // request would still see the old (revoked) session in the request headers,
  // so navigate: the next request carries the new cookie.
  redirect(`/settings?${PASSWORD_CHANGED_PARAM}=1`);
}
