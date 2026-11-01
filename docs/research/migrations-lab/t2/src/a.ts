import { pgTable, text, uuid } from "drizzle-orm/pg-core";
export const a = pgTable("a", { id: uuid().primaryKey(), name: text().notNull(), age: text() });
