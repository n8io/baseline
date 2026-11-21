import { describe, expect, it } from "vitest";
import {
	postgresErrorIsUniqueViolation,
	postgresUniqueViolationRead,
} from "./index.ts";

const violation = { code: "23505", constraint: "foo_name_key" };

describe("postgresErrorIsUniqueViolation", () => {
	it("matches a 23505 on the constraint, directly or in the cause chain", () => {
		expect(postgresErrorIsUniqueViolation(violation, "foo_name_key")).toBe(
			true,
		);
		expect(
			postgresErrorIsUniqueViolation(
				new Error("outer", { cause: new Error("mid", { cause: violation }) }),
				"foo_name_key",
			),
		).toBe(true);
	});

	it("rejects another constraint, another code or a non-error", () => {
		expect(postgresErrorIsUniqueViolation(violation, "foo_pkey")).toBe(false);
		expect(
			postgresErrorIsUniqueViolation(
				{ code: "23503", constraint: "foo_name_key" },
				"foo_name_key",
			),
		).toBe(false);
		expect(postgresErrorIsUniqueViolation(undefined, "foo_name_key")).toBe(
			false,
		);
		expect(postgresErrorIsUniqueViolation("23505", "foo_name_key")).toBe(false);
	});

	it("stops on a cause cycle", () => {
		const first: { cause?: unknown } = {};
		first.cause = { cause: first };

		expect(postgresErrorIsUniqueViolation(first, "foo_name_key")).toBe(false);
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
});
