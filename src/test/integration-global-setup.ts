import { resetTestDatabase } from "./db";

/** Vitest globalSetup for integration tests: fresh, fully migrated test database. */
export default async function setup() {
  await resetTestDatabase();
}
