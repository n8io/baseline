import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import {
	postgresPoolCreate,
	postgresUniqueViolationIs,
	postgresUniqueViolationRead,
} from "./index.ts";

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

describe("postgresUniqueViolationRead", () => {
	it("reads the constraint, columns and values from the detail", () => {
		expect(
			postgresUniqueViolationRead(
				new Error("outer", {
					cause: {
						...violation,
						detail: "Key (league_id, name)=(7, Eagles) already exists.",
					},
				}),
			),
		).toEqual({
			columns: ["league_id", "name"],
			constraint: "foo_name_key",
			values: ["7", "Eagles"],
		});
	});

	it("leaves columns and values empty when the detail is missing or cannot be split", () => {
		const empty = { columns: [], constraint: "foo_name_key", values: [] };
		expect(postgresUniqueViolationRead(violation)).toEqual(empty);
		expect(
			postgresUniqueViolationRead({
				...violation,
				detail: "Key (league_id, name)=(7, Eagles, Inc) already exists.",
			}),
		).toEqual(empty);
		expect(
			postgresUniqueViolationRead({
				...violation,
				detail: "Key (name)=(Eagles, Inc) already exists.",
			}),
		).toEqual({ ...empty, columns: ["name"], values: ["Eagles, Inc"] });
	});

	it("answers undefined for anything that is not a unique violation", () => {
		expect(postgresUniqueViolationRead(new Error("other"))).toBeUndefined();
		expect(
			postgresUniqueViolationRead({ code: "23503", constraint: "x" }),
		).toBeUndefined();
		expect(postgresUniqueViolationRead(undefined)).toBeUndefined();
	});

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
