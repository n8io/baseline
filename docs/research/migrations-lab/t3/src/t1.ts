import { pgTable, text, uuid, timestamp, index } from "drizzle-orm/pg-core";
export const t1 = pgTable("t1", { id: uuid().primaryKey(), name: text().notNull(), created: timestamp({ withTimezone: true }).defaultNow() }, (t) => [index("t1_name_idx").on(t.name)]);
