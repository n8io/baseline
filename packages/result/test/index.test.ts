import { describe, expect, expectTypeOf, it } from "vitest";
import * as resultExports from "../src/index.ts";
import { err, ok, type Result } from "../src/index.ts";

class FooNotFoundError extends Error {
	readonly type = "FooNotFoundError";
}

const fooFind = (name: string): Result<{ name: string }, FooNotFoundError> =>
	name === "missing" ? err(new FooNotFoundError(name)) : ok({ name });

describe("ok", () => {
	it("wraps a value as a success, typed with the literal true", () => {
		expect(ok(42)).toEqual({ ok: true, value: 42 });
		expectTypeOf(ok(42)).toEqualTypeOf<{
			readonly ok: true;
			readonly value: number;
		}>();
		expectTypeOf(ok(42)).toExtend<Result<number, never>>();
	});

	it("keeps the value by reference", () => {
		const value = { name: "foo" };

		expect(ok(value).value).toBe(value);
	});
});

describe("err", () => {
	it("wraps an error as a failure, typed with the literal false", () => {
		const error = new FooNotFoundError("foo");

		expect(err(error)).toEqual({ error, ok: false });
		expectTypeOf(err(error)).toEqualTypeOf<{
			readonly error: FooNotFoundError;
			readonly ok: false;
		}>();
		expectTypeOf(err(error)).toExtend<Result<never, FooNotFoundError>>();
		expect(err(error).error).toBe(error);
	});
});

describe("Result", () => {
	it("narrows to the value when ok", () => {
		const result = fooFind("foo");

		expect(result).toEqual(ok({ name: "foo" }));
		if (result.ok) expectTypeOf(result.value).toEqualTypeOf<{ name: string }>();
	});

	it("narrows to the error when not ok", () => {
		const result = fooFind("missing");

		expect(result).toEqual(err(expect.any(FooNotFoundError)));
		if (!result.ok)
			expectTypeOf(result.error).toEqualTypeOf<FooNotFoundError>();
	});
});

describe("exports", () => {
	it("exports exactly ok and err at runtime", () => {
		expect(Object.keys(resultExports).sort()).toEqual(["err", "ok"]);
	});
});
