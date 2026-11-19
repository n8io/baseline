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
			"fooUpdate: foo update",
			"invoiceLineCustomerAssign: invoice-line customer-assign",
		]);
	});

	it("reads a field's allowed values, default and description from its schema", () => {
		const list = cliCommandsRead(cliTestDocument).find(
			(command) => command.operationId === "fooList",
		);
		expect(list?.fields.slice(2)).toEqual([
			{
				default: false,
				description: "Count every match",
				flag: "count",
				in: "query",
				kind: "boolean",
				name: "count",
				required: false,
			},
			{
				choices: ["createdAt", "-createdAt", "name", "-name"],
				default: "-createdAt",
				description: "The order of the page",
				flag: "sort",
				in: "query",
				kind: "string",
				name: "sort",
				required: false,
			},
		]);
		const nullableEnum = cliCommandsRead(
			operationDocument({
				operationId: "fooCreate",
				parameters: [
					{
						in: "query",
						name: "level",
						schema: {
							anyOf: [{ enum: [1, 2], type: "integer" }, { type: "null" }],
						},
					},
					{
						in: "query",
						name: "tags",
						schema: { items: { enum: ["a", "b"] }, type: "array" },
					},
				],
				tags: ["foo"],
			}),
		)[0]?.fields;
		expect(
			nullableEnum?.map(({ choices, kind }) => ({ choices, kind })),
		).toEqual([
			{ choices: ["1", "2"], kind: "number" },
			{ choices: ["a", "b"], kind: "array" },
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
				itemKind: "string",
				kind: "array",
				name: "tags",
				required: false,
			},
		]);
	});

	it("puts path fields first, in path order, including the path item's own", () => {
		const [, , get, update, assign] = cliCommandsRead(cliTestDocument);
		expect(
			update?.fields.map(({ in: where, name }) => `${where} ${name}`),
		).toEqual(["path id", "query dry", "body ids", "body note"]);
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

describe("cliCommandsRead field kinds", () => {
	it("reads a nullable anyOf as its one type, a string enum as text and an array's items", () => {
		const update = cliCommandsRead(cliTestDocument).find(
			(command) => command.operationId === "fooUpdate",
		);
		expect(
			update?.fields.map(({ itemKind, kind, name }) => ({
				itemKind,
				kind,
				name,
			})),
		).toEqual([
			{ itemKind: undefined, kind: "string", name: "id" },
			{ itemKind: undefined, kind: "boolean", name: "dry" },
			{ itemKind: "number", kind: "array", name: "ids" },
			{ itemKind: undefined, kind: "string", name: "note" },
		]);
	});
});

describe("cliCommandsRead refusals", () => {
	it("refuses a command the CLI keeps for itself and a header parameter", () => {
		expect(() =>
			cliCommandsRead(
				operationDocument({ operationId: "loginGet", tags: ["login"] }),
			),
		).toThrow('would be the command "login get"');
		expect(() =>
			cliCommandsRead(
				operationDocument({
					operationId: "fooCreate",
					parameters: [{ in: "header", name: "x-tenant" }],
					tags: ["foo"],
				}),
			),
		).toThrow("fooCreate has a header parameter, x-tenant");
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
