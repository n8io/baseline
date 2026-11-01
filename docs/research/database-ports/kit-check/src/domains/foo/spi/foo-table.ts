import { pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const fooTable = pgTable(
  "foo",
  { id: uuid().primaryKey(), name: text().notNull() },
  (table) => [uniqueIndex("foo_name_unique").on(table.name)],
);

export const fooTagTable = pgTable(
  "foo_tag",
  {
    fooId: uuid("foo_id")
      .notNull()
      .references(() => fooTable.id),
    tag: text().notNull(),
  },
  (table) => [primaryKey({ columns: [table.fooId, table.tag] })],
);
