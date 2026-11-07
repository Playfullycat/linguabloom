import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getAuth } from ".";

/** Narrow view of the signed-in user. Never expose the raw session to the client. */
export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: "owner";
};

/**
 * Data Access Layer entry point: reads and validates the session against
 * the database (Better Auth database sessions). Deduplicated per request.
 * Must be called inside a <Suspense> boundary (it reads request headers).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const { id, name, email, role } = session.user;
  if (role !== "owner") return null;
  return { id, name, email, role: "owner" };
});

/** Use in every protected page, action and route. Redirects to /login otherwise. */
export async function requireOwner(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
