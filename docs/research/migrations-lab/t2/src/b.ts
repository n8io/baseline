import { pgTable, text, uuid } from "drizzle-orm/pg-core";
export const b = pgTable("b", { id: uuid().primaryKey(), label: text(), extra: text() });
