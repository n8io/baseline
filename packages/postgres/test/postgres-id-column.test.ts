import { type Id, idCreate, idToUuid } from "@n8io/baseline-id";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text } from "drizzle-orm/pg-core";
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	expectTypeOf,
	it,
} from "vitest";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import { postgresIdColumn, postgresPoolCreate } from "../src/index.ts";

const fooTable = pgTable("foo", {
	id: postgresIdColumn("foo")().primaryKey(),
	name: text().notNull(),
});

let pgPool: ReturnType<typeof postgresPoolCreate>;

beforeAll(async () => {
	pgPool = postgresPoolCreate({
		databaseUrl: await postgresTestDatabaseCreate(),
	});
	await pgPool.query(
		"CREATE TABLE foo (id uuid PRIMARY KEY, name text NOT NULL)",
	);
});

afterAll(async () => {
	await pgPool.end();
});

describe("postgresIdColumn", () => {
	it("stores a uuid and reads back the prefixed id", async () => {
		const db = drizzle({ client: pgPool });
		const id = idCreate("foo");
		await db.insert(fooTable).values({ id, name: "one" });

		const [row] = await db.select().from(fooTable).where(eq(fooTable.id, id));
		const raw = await db.execute<{ id: string; type: string }>(
			sql`SELECT id::text AS id, pg_typeof(id)::text AS type FROM foo`,
		);

		expectTypeOf(row?.id).toEqualTypeOf<Id<"foo"> | undefined>();
		expect(row).toEqual({ id, name: "one" });
		expect(raw.rows).toEqual([{ id: idToUuid(id), type: "uuid" }]);
	});

	it("refuses an id with another prefix cast past the types", async () => {
		const db = drizzle({ client: pgPool });
		const barId = idCreate("bar") as string as Id<"foo">;

		await expect(async () => {
			await db.insert(fooTable).values({ id: barId, name: "two" });
		}).rejects.toThrow(new TypeError("Expected a foo id"));
	});
});
