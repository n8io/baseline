import { pgTable, text, uuid, timestamp, index } from "drizzle-orm/pg-core";
export const t5 = pgTable("t5", { id: uuid().primaryKey(), name: text().notNull(), created: timestamp({ withTimezone: true }).defaultNow() }, (t) => [index("t5_name_idx").on(t.name)]);
