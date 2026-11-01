import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { fooTable } from "../../foo/spi/foo-table.ts";

export const barTable = pgTable("bar", { id: uuid().primaryKey(), fooId: uuid("foo_id").references(() => fooTable.id), label: text().notNull() });
