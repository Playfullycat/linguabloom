import { sql } from "drizzle-orm";
import { connection, NextResponse } from "next/server";

import { getDb } from "@/db";
import { APP_VERSION } from "@/lib/config/app-info";

const DB_TIMEOUT_MS = 3000;

type CheckResult = { status: "ok" | "error"; latencyMs?: number };

/**
 * Liveness/readiness probe for Docker and scripts/healthcheck.sh.
 * Public by design, so it reports status only — no hostnames, errors or config.
 */
export async function GET() {
  await connection(); // always evaluate at request time

  const database = await checkDatabase();
  const ok = database.status === "ok";

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      version: APP_VERSION,
      time: new Date().toISOString(),
      checks: { database },
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

async function checkDatabase(): Promise<CheckResult> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDb().execute(sql`select 1`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${DB_TIMEOUT_MS}ms`)), DB_TIMEOUT_MS);
      }),
    ]);
    return { status: "ok", latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    // Details go to the server log only.
    console.error("[health] database check failed:", error instanceof Error ? error.message : error);
    return { status: "error" };
  } finally {
    clearTimeout(timer);
  }
}
