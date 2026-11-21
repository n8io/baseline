import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import {
	postgresErrorIsUniqueViolation,
	postgresPoolCreate,
	postgresUniqueViolationRead,
} from "./index.ts";

describe("postgresErrorIsUniqueViolation", () => {
	it("finds the pg error inside Drizzle's DrizzleQueryError", async () => {
		await using pgPool = postgresPoolCreate({
			databaseUrl: await postgresTestDatabaseCreate(),
		});
		const db = drizzle({ client: pgPool });
		await db.execute(
			sql`CREATE TABLE foo (name text CONSTRAINT foo_name_key UNIQUE)`,
		);
		await db.execute(sql`INSERT INTO foo (name) VALUES ('one')`);

		const error = await db
			.execute(sql`INSERT INTO foo (name) VALUES ('one')`)
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).constructor.name).toBe("DrizzleQueryError");
		expect(postgresErrorIsUniqueViolation(error, "foo_name_key")).toBe(true);
		expect(postgresErrorIsUniqueViolation(error, "foo_pkey")).toBe(false);
	});
});

describe("postgresUniqueViolationRead", () => {
	it("reads a real composite violation through DrizzleQueryError", async () => {
		await using pgPool = postgresPoolCreate({
			databaseUrl: await postgresTestDatabaseCreate(),
		});
		const db = drizzle({ client: pgPool });
		await db.execute(
			sql`CREATE TABLE team (league int, name text, CONSTRAINT team_league_name_key UNIQUE (league, name))`,
		);
		await db.execute(sql`INSERT INTO team VALUES (7, 'Eagles')`);

		const error = await db
			.execute(sql`INSERT INTO team VALUES (7, 'Eagles')`)
			.catch((caught: unknown) => caught);

		expect(postgresUniqueViolationRead(error)).toEqual({
			columns: ["league", "name"],
			constraint: "team_league_name_key",
			values: ["7", "Eagles"],
		});
	});
});
