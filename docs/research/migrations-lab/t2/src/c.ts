import { pgTable, text, uuid } from "drizzle-orm/pg-core";
export const c = pgTable("c", { id: uuid().primaryKey(), note: text() });
