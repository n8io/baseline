import { describe, expect, it } from "vitest";
import { problemCodesOpen, securityBearerDeclare } from "./api-check.ts";

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

describe("securityBearerDeclare", () => {
	it("gives a base document without security the bearer scheme and requirement", () => {
		expect(
			securityBearerDeclare({ components: { schemas: {} }, paths: {} }),
		).toStrictEqual({
			components: {
				schemas: {},
				securitySchemes: {
					bearer: { bearerFormat: "JWT", scheme: "bearer", type: "http" },
				},
			},
			paths: {},
			security: [{ bearer: [] }],
		});
	});

	it("leaves a document that already declares security alone", () => {
		const document = { paths: {}, security: [{ other: [] }] };

		expect(securityBearerDeclare(structuredClone(document))).toStrictEqual(
			document,
		);
	});
});
