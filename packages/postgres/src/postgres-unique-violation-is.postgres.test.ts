import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import { postgresPoolCreate, postgresUniqueViolationIs } from "./index.ts";

const violation = { code: "23505", constraint: "foo_name_key" };

describe("postgresUniqueViolationIs", () => {
	it("matches a 23505 on the constraint, directly or in the cause chain", () => {
		expect(postgresUniqueViolationIs(violation, "foo_name_key")).toBe(true);
		expect(
			postgresUniqueViolationIs(
				new Error("outer", { cause: new Error("mid", { cause: violation }) }),
				"foo_name_key",
			),
		).toBe(true);
	});

	it("rejects another constraint, another code or a non-error", () => {
		expect(postgresUniqueViolationIs(violation, "foo_pkey")).toBe(false);
		expect(
			postgresUniqueViolationIs(
				{ code: "23503", constraint: "foo_name_key" },
				"foo_name_key",
			),
		).toBe(false);
		expect(postgresUniqueViolationIs(undefined, "foo_name_key")).toBe(false);
		expect(postgresUniqueViolationIs("23505", "foo_name_key")).toBe(false);
	});

	it("stops on a cause cycle", () => {
		const first: { cause?: unknown } = {};
		first.cause = { cause: first };

		expect(postgresUniqueViolationIs(first, "foo_name_key")).toBe(false);
	});

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
		expect(postgresUniqueViolationIs(error, "foo_name_key")).toBe(true);
		expect(postgresUniqueViolationIs(error, "foo_pkey")).toBe(false);
	});
});
