import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/connection";
import { appInstance, users } from "@/db/schema";
import type { Auth } from "@/lib/auth/create-auth";

/** An unfinished claim older than this is treated as abandoned (crashed setup). */
export const STALE_SETUP_CLAIM_MINUTES = 5;

export type SetupStatus = { ownerExists: boolean };

export async function getSetupStatus(db: DbExecutor): Promise<SetupStatus> {
  const [row] = await db
    .select({ completedAt: appInstance.setupCompletedAt })
    .from(appInstance)
    .where(eq(appInstance.id, 1))
    .limit(1);
  return { ownerExists: Boolean(row?.completedAt) };
}

export type CreateOwnerInput = { name: string; email: string; password: string };

export type CreateOwnerResult = { ok: true; userId: string } | { ok: false; reason: "already_initialized" };

/**
 * Create the single owner account (first-run setup).
 *
 * 1. Atomically claim the `app_instance` row. Only one request can win; a
 *    completed setup can never be claimed again.
 * 2. Create the user and its credential account through Better Auth's
 *    internal adapter (public sign-up stays disabled).
 * 3. Mark setup complete. On failure, release the claim so setup can retry.
 */
export async function createOwner(
  { db, auth }: { db: Database; auth: Auth },
  input: CreateOwnerInput,
): Promise<CreateOwnerResult> {
  const claimed = await db
    .insert(appInstance)
    .values({ id: 1 })
    .onConflictDoUpdate({
      target: appInstance.id,
      set: { setupStartedAt: sql`now()` },
      setWhere: sql`${appInstance.setupCompletedAt} is null and ${appInstance.setupStartedAt} < now() - make_interval(mins => ${STALE_SETUP_CLAIM_MINUTES})`,
    })
    .returning({ id: appInstance.id });

  if (claimed.length === 0) return { ok: false, reason: "already_initialized" };

  try {
    const ctx = await auth.$context;
    // We hold the claim and setup never completed, so any existing users are
    // leftovers of an interrupted attempt. Sessions/accounts cascade.
    await db.delete(users);

    const passwordHash = await ctx.password.hash(input.password);
    const user = await ctx.internalAdapter.createUser(
      {
        name: input.name,
        email: input.email.toLowerCase(),
        emailVerified: true,
        role: "owner",
      },
      { method: "email-password" },
    );
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: passwordHash,
    });

    await db
      .update(appInstance)
      .set({ ownerUserId: user.id, setupCompletedAt: new Date() })
      .where(eq(appInstance.id, 1));

    return { ok: true, userId: user.id };
  } catch (error) {
    await db.delete(users);
    await db.delete(appInstance).where(and(eq(appInstance.id, 1), isNull(appInstance.setupCompletedAt)));
    throw error;
  }
}
