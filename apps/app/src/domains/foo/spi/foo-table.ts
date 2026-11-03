import { postgresIdColumn } from "@n8io/baseline-postgres";
import {
	index,
	pgSchema,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

export const fooSchema = pgSchema("foo");

export const foo = fooSchema.table(
	"foo",
	{
		id: postgresIdColumn("foo")().primaryKey(),
		name: text().notNull(),
		createdBy: text("created_by").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
	},
	(t) => [
		uniqueIndex("foo_name_key").on(t.name),
		index("foo_created_at_idx").on(t.createdAt),
		index("foo_updated_at_idx").on(t.updatedAt),
	],
);
