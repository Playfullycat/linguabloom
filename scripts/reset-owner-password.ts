/**
 * Rescue: set a new password for the owner when it is forgotten, and sign out
 * every session. Runs on the server only (needs database access).
 *
 *   Docker:   docker compose exec app node ops/reset-owner-password.mjs
 *   Local:    npm run owner:reset-password
 *
 * The password is typed (hidden) or piped on stdin — never passed as an
 * argument, so it does not end up in shell history or process lists:
 *   printf '%s' 'new password' | docker compose exec -T app node ops/reset-owner-password.mjs
 */
import { existsSync } from "node:fs";
import { stdin, stdout } from "node:process";

import { and, eq } from "drizzle-orm";

import { createDb } from "../src/db/connection";
import { accounts, sessions, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import { newPasswordSchema } from "../src/modules/auth/schemas";

if (existsSync(".env")) process.loadEnvFile(".env");

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    stdout.write(prompt);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") process.exit(130); // Ctrl+C
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function readPiped(): Promise<string> {
  let data = "";
  for await (const chunk of stdin) data += chunk;
  return data.replace(/\r?\n$/, "");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  let password: string;
  if (stdin.isTTY) {
    password = await readHidden("New password: ");
    const again = await readHidden("Repeat new password: ");
    if (password !== again) throw new Error("The passwords do not match. Nothing was changed.");
  } else {
    password = await readPiped();
  }

  const parsed = newPasswordSchema.safeParse(password);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid password.");

  const { db, client } = createDb(url, { max: 1 });
  try {
    const [owner] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.role, "owner"));
    if (!owner) throw new Error("No owner account exists yet. Open /setup in the browser instead.");

    const hash = await hashPassword(parsed.data);
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(accounts)
        .set({ password: hash })
        .where(and(eq(accounts.userId, owner.id), eq(accounts.providerId, "credential")))
        .returning({ id: accounts.id });
      if (updated.length === 0) throw new Error("The owner has no password account.");
      await tx.delete(sessions).where(eq(sessions.userId, owner.id));
    });
    console.log(`Password updated for ${owner.email}. All sessions were signed out.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
