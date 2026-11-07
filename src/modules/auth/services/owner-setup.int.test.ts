import { APIError } from "better-auth/api";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/db/connection";
import { accounts, appInstance, users } from "@/db/schema";
import { createAuth } from "@/lib/auth/create-auth";
import { parseEnv } from "@/lib/config/env";
import { getTestDatabaseUrl, truncateAll } from "@/test/db";

import { createOwner, getSetupStatus } from "./owner-setup";

const url = getTestDatabaseUrl();
const { db, client } = createDb(url, { max: 6 });
const env = parseEnv({
  APP_SECRET: "integration-test-secret-integration-test-secret",
  DATABASE_URL: url,
  APP_URL: "http://localhost:3000",
});
const auth = createAuth({ db, env, withNextCookies: false });
const owner = { name: "Test Owner", email: "Owner@Example.test", password: "integration-pass-1" };

beforeEach(() => truncateAll(url));
afterAll(() => client.end());

async function countUsers() {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return row!.n;
}

describe("first-run owner setup", () => {
  it("reports no owner on a fresh install", async () => {
    expect(await getSetupStatus(db)).toEqual({ ownerExists: false });
  });

  it("creates exactly one owner with an Argon2id credential", async () => {
    const result = await createOwner({ db, auth }, owner);
    expect(result.ok).toBe(true);
    expect(await getSetupStatus(db)).toEqual({ ownerExists: true });

    const [user] = await db.select().from(users);
    expect(user).toMatchObject({ email: "owner@example.test", role: "owner", emailVerified: true });

    const [account] = await db.select().from(accounts).where(eq(accounts.userId, user!.id));
    expect(account?.providerId).toBe("credential");
    expect(account?.password).toMatch(/^\$argon2id\$/);

    const [instance] = await db.select().from(appInstance);
    expect(instance?.ownerUserId).toBe(user!.id);
  });

  it("refuses any further setup once completed", async () => {
    await createOwner({ db, auth }, owner);
    const second = await createOwner({ db, auth }, { ...owner, email: "intruder@example.test" });
    expect(second).toEqual({ ok: false, reason: "already_initialized" });
    expect(await countUsers()).toBe(1);
  });

  it("lets only one of several concurrent setup requests win", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => createOwner({ db, auth }, { ...owner, email: `racer${i}@example.test` })),
    );
    const winners = attempts.filter((a) => a.status === "fulfilled" && a.value.ok);
    expect(winners).toHaveLength(1);
    expect(await countUsers()).toBe(1);
  });

  it("recovers from an abandoned setup (stale claim + orphan user)", async () => {
    await db.insert(users).values({ name: "orphan", email: "orphan@example.test" });
    await db.insert(appInstance).values({ id: 1, setupStartedAt: sql`now() - interval '10 minutes'` });

    const result = await createOwner({ db, auth }, owner);
    expect(result.ok).toBe(true);
    const emails = (await db.select({ email: users.email }).from(users)).map((u) => u.email);
    expect(emails).toEqual(["owner@example.test"]);
  });

  it("does not take over a setup that is still in progress", async () => {
    await db.insert(appInstance).values({ id: 1 }); // claimed just now, not completed
    expect(await createOwner({ db, auth }, owner)).toEqual({ ok: false, reason: "already_initialized" });
  });
});

describe("signing in", () => {
  it("accepts the right password, rejects a wrong one, and records the login time", async () => {
    await createOwner({ db, auth }, owner);

    await expect(
      auth.api.signInEmail({ body: { email: "owner@example.test", password: "wrong-password-1" } }),
    ).rejects.toBeInstanceOf(APIError);

    const ok = await auth.api.signInEmail({ body: { email: "owner@example.test", password: owner.password } });
    expect(ok.token).toBeTruthy();

    const [user] = await db.select({ lastLoginAt: users.lastLoginAt }).from(users);
    expect(user?.lastLoginAt).toBeInstanceOf(Date);
  });

  it("keeps public sign-up closed, even before setup", async () => {
    await expect(
      auth.api.signUpEmail({ body: { name: "x", email: "new@example.test", password: "some-password-1" } }),
    ).rejects.toMatchObject({ body: { code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" } });
    expect(await countUsers()).toBe(0);
  });
});
