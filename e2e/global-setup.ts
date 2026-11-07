import { resetTestDatabase } from "../src/test/db";

/** Every E2E run starts from an empty, fully migrated test database (first-run state). */
export default async function globalSetup() {
  await resetTestDatabase();
}
