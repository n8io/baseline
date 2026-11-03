import { describe, expect, it } from "vitest";
import { loggerErrSerialize } from "../src/logger-err-serialize.ts";

// Input text a user could send. None of it may survive serialization.
const canaries = ["canary@example.com", "4111111111111111", "diabetes"];
const input = canaries.join(" ");

// Mirrors pg-protocol's DatabaseError: the message and detail hold input text,
// and the constructor sets name to "error", not the class name.
class DatabaseError extends Error {
	code: string | undefined;
	constraint: string | undefined;
	detail: string | undefined;

	constructor(message: string) {
		super(message);
		this.name = "error";
		this.code = undefined;
		this.constraint = undefined;
		this.detail = undefined;
	}
}

// Mirrors drizzle-orm's DrizzleQueryError: a two-line message holding the query
// and its params, with the driver error as cause.
class DrizzleQueryError extends Error {
	params: unknown[];
	query: string;

	constructor(query: string, params: unknown[], cause: unknown) {
		super(`Failed query: ${query}\nparams: ${params.join(",")}`, { cause });
		this.params = params;
		this.query = query;
	}
}

const databaseErrorCreate = (): DatabaseError => {
	const error = new DatabaseError(
		`duplicate key value violates unique constraint "foo_name_key" (${input})`,
	);
	error.code = "23505";
	error.constraint = "foo_name_key";
	error.detail = `Key (name)=(${input}) already exists.`;
	return error;
};

const expectNoInput = (value: unknown): void => {
	const json = JSON.stringify(value);
	for (const canary of canaries) {
		expect(json).not.toContain(canary);
	}
	expect(json).not.toMatch(/"(message|detail)"/);
};

describe("loggerErrSerialize", () => {
	it("keeps a pg DatabaseError's class, code, constraint and frames", () => {
		const shape = loggerErrSerialize(databaseErrorCreate());

		expect(shape).toMatchObject({
			code: "23505",
			constraint: "foo_name_key",
			type: "DatabaseError",
		});
		expect(shape.stack).toMatch(/^at /);
		expect(shape.stack).toContain("logger-err-serialize.test.ts");
		expect(Object.keys(shape).sort()).toEqual([
			"code",
			"constraint",
			"stack",
			"type",
		]);
		expectNoInput(shape);
	});

	it("repeats the shape down a DrizzleQueryError's cause", () => {
		const error = new DrizzleQueryError(
			"insert into foo (name) values ($1)",
			[input],
			databaseErrorCreate(),
		);
		const shape = loggerErrSerialize(error);

		expect(shape.type).toBe("DrizzleQueryError");
		expect(shape.stack).toMatch(/^at /);
		expect(shape.cause).toMatchObject({
			code: "23505",
			constraint: "foo_name_key",
			type: "DatabaseError",
		});
		expect(shape.cause?.stack).toMatch(/^at /);
		expectNoInput(shape);
	});

	it("drops the input JSON.parse quotes in its SyntaxError", () => {
		let error: unknown;
		try {
			JSON.parse(`{"email": ${input}}`);
		} catch (caught) {
			error = caught;
		}
		const shape = loggerErrSerialize(error);

		expect(shape.type).toBe("SyntaxError");
		expect(shape.stack).toMatch(/^at JSON\.parse/);
		expectNoInput(shape);
	});

	it("keeps a TypeError's class and frames only", () => {
		let error: unknown;
		try {
			const value = JSON.parse(`{"${input}": null}`) as Record<string, never>;
			(value[input] as unknown as () => void)();
		} catch (caught) {
			error = caught;
		}
		const shape = loggerErrSerialize(error);

		expect(shape.type).toBe("TypeError");
		expect(shape.stack).toMatch(/^at /);
		expectNoInput(shape);
	});

	it("drops message lines that look like frames", () => {
		const error = new Error(`bad input\n    at ${input} (evil.ts:1:1)`);
		const shape = loggerErrSerialize(error);

		expect(shape.stack).toMatch(/^at /);
		expectNoInput(shape);
	});

	it("names a thrown non-error by its type and keeps nothing else", () => {
		expect(loggerErrSerialize(input)).toEqual({ type: "string" });
		expect(loggerErrSerialize({ message: input })).toEqual({ type: "object" });
		expect(loggerErrSerialize(null)).toEqual({ type: "null" });
	});

	it("keeps a numeric code and ignores a code that is not a string or number", () => {
		const numeric = Object.assign(new Error(input), { code: 42 });
		const object = Object.assign(new Error(input), { code: { input } });

		expect(loggerErrSerialize(numeric).code).toBe(42);
		expect(loggerErrSerialize(object)).not.toHaveProperty("code");
		expectNoInput(loggerErrSerialize(object));
	});

	it("stops a cause cycle", () => {
		const error = new Error(input);
		error.cause = error;
		let depth = 0;
		let shape = loggerErrSerialize(error);
		while (shape.cause !== undefined) {
			depth += 1;
			shape = shape.cause;
		}

		expect(depth).toBe(10);
	});
});
