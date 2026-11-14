import { describe, expect, it } from "vitest";
import { problemCodesOpen } from "./api-check.ts";

const problem = (code: Record<string, unknown>) => ({
	paths: {
		"/foos": {
			post: {
				responses: {
					"409": {
						content: {
							"application/problem+json": {
								schema: { properties: { code, status: { type: "integer" } } },
							},
						},
					},
				},
			},
		},
	},
});

describe("problemCodesOpen", () => {
	it("moves a problem's closed code list to x-extensible-enum", () => {
		expect(
			problemCodesOpen(problem({ enum: ["FooNameTaken"], type: "string" })),
		).toStrictEqual(
			problem({ type: "string", "x-extensible-enum": ["FooNameTaken"] }),
		);
	});

	it("leaves an enum outside a problem alone", () => {
		const document = {
			schema: { properties: { code: { enum: ["a"], type: "string" } } },
		};

		expect(problemCodesOpen(structuredClone(document))).toStrictEqual(document);
	});
});
