import { pgTable, text, uuid, timestamp, index } from "drizzle-orm/pg-core";
export const t2 = pgTable("t2", { id: uuid().primaryKey(), name: text().notNull(), created: timestamp({ withTimezone: true }).defaultNow() }, (t) => [index("t2_name_idx").on(t.name)]);
