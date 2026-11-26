import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { FeatureFlagDefinition } from "./feature-flags-define-types.ts";
import { featureFlagsResolve } from "./feature-flags-resolve.ts";
import type { FeatureFlagRead } from "./feature-flags-resolve-types.ts";
import { featureFlagsSchemaValidate } from "./feature-flags-schema-validate.ts";

const found = (value: unknown): FeatureFlagRead => ({ found: true, value });
const flag: FeatureFlagDefinition = { fallback: 10, key: "limit" };
const copy: FeatureFlagDefinition = {
	fallback: "a",
	key: "copy",
	values: ["a", "b"],
};
const theme: FeatureFlagDefinition = {
	fallback: { mode: "light" },
	key: "theme",
	schema: z.object({ mode: z.enum(["dark", "light"]) }),
};

describe("featureFlagsResolve", () => {
	it.each([
		["a value of the declared type", flag, found(3), 3, null],
		["a value of another type", flag, found("3"), 10, "wrongType"],
		["null for a number", flag, found(null), 10, "wrongType"],
		["a value inside values", copy, found("b"), "b", null],
		["a value outside values", copy, found("c"), "a", "notInValues"],
		["a number for a string flag", copy, found(1), "a", "wrongType"],
		[
			"a value its schema accepts",
			theme,
			found({ mode: "dark" }),
			{ mode: "dark" },
			null,
		],
		[
			"a value its schema rejects",
			theme,
			found({ mode: "neon" }),
			{ mode: "light" },
			"schemaFailed",
		],
		[
			"null for a schema",
			theme,
			found(null),
			{ mode: "light" },
			"schemaFailed",
		],
		[
			"an array for a schema",
			theme,
			found([]),
			{ mode: "light" },
			"schemaFailed",
		],
		[
			"a flag the service lacks",
			flag,
			{ found: false, reason: "notFound" },
			10,
			"notFound",
		],
		[
			"an outage",
			flag,
			{ found: false, reason: "vendorError" },
			10,
			"vendorError",
		],
		[
			"the service saying wrong type",
			flag,
			{ found: false, reason: "wrongType" },
			10,
			"wrongType",
		],
	] as const)(
		"turns %s into the value or the fallback",
		(_name, definition, read, value, reason) => {
			expect(featureFlagsResolve({ definition, read })).toEqual({
				reason,
				value,
			});
		},
	);

	it("returns a schema's output, not the raw value", () => {
		const definition: FeatureFlagDefinition = {
			fallback: 0,
			key: "n",
			schema: z.coerce.number(),
		};
		expect(featureFlagsResolve({ definition, read: found("42") })).toEqual({
			reason: null,
			value: 42,
		});
	});
});

describe("featureFlagsSchemaValidate", () => {
	it("treats a schema that throws or answers late as a failure", () => {
		const throwing = {
			"~standard": {
				validate: () => {
					throw new Error("boom");
				},
				vendor: "test",
				version: 1,
			},
		} as const;
		const late = {
			"~standard": {
				validate: () => Promise.resolve({ value: 1 }),
				vendor: "test",
				version: 1,
			},
		} as const;
		expect(featureFlagsSchemaValidate({ schema: throwing, value: 1 })).toEqual({
			async: false,
			ok: false,
		});
		expect(featureFlagsSchemaValidate({ schema: late, value: 1 })).toEqual({
			async: true,
			ok: false,
		});
	});
});
