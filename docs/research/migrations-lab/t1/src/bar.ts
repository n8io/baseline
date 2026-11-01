import { pgSchema, text, uuid } from "drizzle-orm/pg-core";
import { fooTable } from "./foo.ts";
export const barSchema = pgSchema("bar");
export const barTable = barSchema.table("bar", { id: uuid().primaryKey(), fooId: uuid("foo_id").references(() => fooTable.id), label: text() });
