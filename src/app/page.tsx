import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getSetupStatus } from "@/modules/auth/services/owner-setup";

/** Entry point: first run → /setup, signed in → /today, otherwise → /login. */
export default function Home() {
  return (
    <Suspense fallback={null}>
      <EntryRedirect />
    </Suspense>
  );
}

async function EntryRedirect(): Promise<null> {
  await connection();
  const { ownerExists } = await getSetupStatus(getDb());
  if (!ownerExists) redirect("/setup");
  redirect((await getCurrentUser()) ? "/today" : "/login");
  return null; // unreachable: redirect() throws
}
