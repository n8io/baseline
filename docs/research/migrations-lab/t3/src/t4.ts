import { pgTable, text, uuid, timestamp, index } from "drizzle-orm/pg-core";
export const t4 = pgTable("t4", { id: uuid().primaryKey(), name: text().notNull(), created: timestamp({ withTimezone: true }).defaultNow() }, (t) => [index("t4_name_idx").on(t.name)]);
