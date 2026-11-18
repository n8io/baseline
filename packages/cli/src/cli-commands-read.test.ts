import { describe, expect, it } from "vitest";
import { cliCommandsRead, cliKebab } from "./cli-commands-read.ts";
import { cliTestDocument } from "./cli-test-app.ts";

const operationDocument = (operation: Record<string, unknown>) => ({
	paths: { "/api/v1/foos": { post: operation } },
});

describe("cliCommandsRead", () => {
	it("names each command <tag> <rest of operationId> in kebab-case", () => {
		expect(
			cliCommandsRead(cliTestDocument).map(
				({ group, name, operationId }) => `${operationId}: ${group} ${name}`,
			),
		).toEqual([
			"fooList: foo list",
			"fooCreate: foo create",
			"fooGet: foo get",
			"invoiceLineCustomerAssign: invoice-line customer-assign",
		]);
	});

	it("reads body fields through $ref, with their kind and whether they are required", () => {
		const create = cliCommandsRead(cliTestDocument).find(
			(command) => command.operationId === "fooCreate",
		);
		expect(create).toMatchObject({ body: true, query: false });
		expect(create?.fields).toEqual([
			{
				flag: "draft",
				in: "body",
				kind: "boolean",
				name: "draft",
				required: false,
			},
			{
				flag: "name",
				in: "body",
				kind: "string",
				name: "name",
				required: true,
			},
			{
				flag: "size",
				in: "body",
				kind: "number",
				name: "size",
				required: false,
			},
			{
				flag: "tags",
				in: "body",
				kind: "array",
				name: "tags",
				required: false,
			},
		]);
	});

	it("puts path fields first, in path order, including the path item's own", () => {
		const [, , get, assign] = cliCommandsRead(cliTestDocument);
		expect(get?.fields.map(({ name }) => name)).toEqual(["id"]);
		expect(assign?.fields.map(({ name }) => name)).toEqual([
			"invoiceLineId",
			"customerId",
		]);
	});

	it("refuses an operation without one tag that its operationId starts with", () => {
		for (const operation of [
			{ operationId: "fooCreate" },
			{ operationId: "fooCreate", tags: ["foo", "bar"] },
			{ operationId: "barCreate", tags: ["foo"] },
			{ operationId: "foolCreate", tags: ["foo"] },
		]) {
			expect(() => cliCommandsRead(operationDocument(operation))).toThrow(
				"cliCreate: POST /api/v1/foos needs one tag and an operationId that starts with it",
			);
		}
	});

	it("refuses a field the CLI keeps for itself or two fields with one flag", () => {
		const body = (properties: Record<string, unknown>) => ({
			operationId: "fooCreate",
			requestBody: {
				content: { "application/json": { schema: { properties } } },
			},
			tags: ["foo"],
		});
		expect(() =>
			cliCommandsRead(operationDocument(body({ url: { type: "string" } }))),
		).toThrow("both --url, or one that the CLI keeps for itself");
		expect(() =>
			cliCommandsRead(
				operationDocument(body({ a_b: { type: "string" }, aB: {} })),
			),
		).toThrow("both --a-b");
	});
});

describe("cliKebab", () => {
	it("splits camelCase and snake_case", () => {
		expect(["invoiceLine", "client_id", "v2Items"].map(cliKebab)).toEqual([
			"invoice-line",
			"client-id",
			"v2-items",
		]);
	});
});
