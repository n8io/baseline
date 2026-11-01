import { pgTable, text, uuid, timestamp, index } from "drizzle-orm/pg-core";
export const t3 = pgTable("t3", { id: uuid().primaryKey(), name: text().notNull(), created: timestamp({ withTimezone: true }).defaultNow() }, (t) => [index("t3_name_idx").on(t.name)]);
