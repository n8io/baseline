import { postgresIdColumnCreate } from "@n8io/baseline-postgres";
import { index, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

// The context's schema; foo-table.ts names it too, and both mean the one Postgres schema.
const fooSchema = pgSchema("foo");

// No foreign key to foo.foo: fooDelete deletes a Foo's Bars in its own transaction.
export const bar = fooSchema.table(
	"bar",
	{
		id: postgresIdColumnCreate("bar")().primaryKey(),
		fooId: postgresIdColumnCreate("foo")("foo_id").notNull(),
		text: text().notNull(),
		createdBy: text("created_by").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(t) => [index("bar_foo_id_created_at_idx").on(t.fooId, t.createdAt)],
);
