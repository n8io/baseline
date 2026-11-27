import { describe, expect, it } from "vitest";
import { z } from "zod";
import { featureFlagsSchemaValidate } from "./feature-flags-schema-validate.ts";

describe("featureFlagsSchemaValidate", () => {
	it("returns the schema's value when it passes", () => {
		expect(
			featureFlagsSchemaValidate({
				schema: z.object({ mode: z.string() }),
				value: { mode: "dark" },
			}),
		).toEqual({ ok: true, value: { mode: "dark" } });
	});

	it("fails without async when the schema reports issues", () => {
		expect(
			featureFlagsSchemaValidate({ schema: z.string(), value: 1 }),
		).toStrictEqual({ async: false, ok: false });
	});

	it("fails with async when the schema answers with a Promise", () => {
		expect(
			featureFlagsSchemaValidate({
				schema: {
					"~standard": {
						validate: () => Promise.resolve({ value: 1 }),
						vendor: "test",
						version: 1,
					},
				},
				value: 1,
			}),
		).toStrictEqual({ async: true, ok: false });
	});

	it("fails without async when the schema throws", () => {
		expect(
			featureFlagsSchemaValidate({
				schema: {
					"~standard": {
						validate: () => {
							throw new Error("boom");
						},
						vendor: "test",
						version: 1,
					},
				},
				value: 1,
			}),
		).toStrictEqual({ async: false, ok: false });
	});

	it("does not take a function with a then for a Promise", () => {
		// biome-ignore lint/suspicious/noThenProperty: the test needs a thenable to pass in.
		const answer = Object.defineProperty(() => undefined, "then", {
			value: () => undefined,
		});
		expect(
			featureFlagsSchemaValidate({
				schema: {
					"~standard": {
						// boundary: a result no Standard Schema returns, to tell it from a Promise
						validate: () => answer as never,
						vendor: "test",
						version: 1,
					},
				},
				value: 1,
			}),
		).toStrictEqual({ ok: true, value: undefined });
	});
});
