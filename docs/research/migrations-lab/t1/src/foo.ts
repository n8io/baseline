import { pgSchema, text, uuid } from "drizzle-orm/pg-core";
export const fooSchema = pgSchema("foo");
export const fooTable = fooSchema.table("foo", { id: uuid().primaryKey(), name: text().notNull() });
