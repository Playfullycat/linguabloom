import { sql } from "drizzle-orm";
import { check, pgTable, smallint, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";

/**
 * Single-row table describing this installation.
 *
 * First-run setup "claims" the row (id = 1) atomically before creating the
 * owner, so two concurrent setup requests can never create two owners.
 * `setup_completed_at` set ⇒ setup is closed for good.
 */
export const appInstance = pgTable(
  "app_instance",
  {
    id: smallint("id").primaryKey().default(1),
    ownerUserId: uuid("owner_user_id")
      .unique()
      .references(() => users.id, { onDelete: "set null" }),
    setupStartedAt: timestamp("setup_started_at", { withTimezone: true }).notNull().defaultNow(),
    setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
  },
  (t) => [check("app_instance_singleton", sql`${t.id} = 1`)],
);
