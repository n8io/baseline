// A CLI over a fixture document and fake operations, run as its own process by the tests:
// `node src/cli-test-app.ts <args>`. Each operation answers with the arguments it was called with.
import type { CliDocument, CliOperation } from "./index.ts";
import { cliCreate } from "./index.ts";

const ok = (args: unknown[]) => ({ data: { args }, status: 200 });

export const cliTestDocument: CliDocument = {
	components: {
		schemas: {
			FooCreate: {
				properties: {
					draft: { type: "boolean" },
					name: { type: "string" },
					size: { type: ["integer", "null"] },
					tags: { items: { type: "string" }, type: "array" },
				},
				required: ["name"],
				type: "object",
			},
		},
	},
	info: { title: "acme-app", version: "1" },
	openapi: "3.1.0",
	paths: {
		"/api/v1/foos": {
			get: {
				operationId: "fooList",
				parameters: [
					{ in: "query", name: "limit", schema: { type: "integer" } },
					{ in: "query", name: "name_prefix", schema: { type: "string" } },
					{
						description: "Count every match",
						in: "query",
						name: "count",
						schema: { default: false, type: "boolean" },
					},
					{
						in: "query",
						name: "sort",
						schema: {
							default: "-createdAt",
							description: "The order of the page",
							enum: ["createdAt", "-createdAt", "name", "-name"],
							type: "string",
						},
					},
				],
				summary: "List foos",
				tags: ["foo"],
			},
			post: {
				description: "Create a foo with a unique name.",
				operationId: "fooCreate",
				requestBody: {
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/FooCreate" },
						},
					},
				},
				summary: "Create a foo",
				tags: ["foo"],
			},
		},
		"/api/v1/foos/{id}": {
			get: { operationId: "fooGet", summary: "Read a foo", tags: ["foo"] },
			patch: {
				operationId: "fooUpdate",
				parameters: [
					// Replaces the path item's id, as OpenAPI allows.
					{
						in: "path",
						name: "id",
						required: true,
						schema: { type: "string" },
					},
					{ in: "query", name: "dry", schema: { type: "boolean" } },
				],
				requestBody: {
					content: {
						"application/json": {
							schema: {
								properties: {
									ids: { items: { type: "integer" }, type: "array" },
									note: { anyOf: [{ type: "string" }, { type: "null" }] },
								},
								type: "object",
							},
						},
					},
				},
				summary: "Change a foo",
				tags: ["foo"],
			},
			parameters: [
				{ in: "path", name: "id", required: true, schema: { type: "string" } },
			],
		},
		"/api/v1/invoice-lines/{invoiceLineId}/customers/{customerId}": {
			put: {
				operationId: "invoiceLineCustomerAssign",
				// Listed out of path order: the SDK takes them in path order.
				parameters: [
					{ in: "path", name: "customerId", required: true },
					{ in: "path", name: "invoiceLineId", required: true },
				],
				summary: "Assign a customer",
				tags: ["invoiceLine"],
			},
		},
	},
	servers: [
		{ description: "development", url: "http://127.0.0.1:1" },
		{ description: "production", url: "https://api.acme.example/" },
	],
	tags: [{ description: "Foos and their names", name: "foo" }],
};

export const cliTestOperations: Record<string, CliOperation> = {
	fooCreate: async (...args: unknown[]) =>
		(args[0] as { name?: string } | undefined)?.name === "taken"
			? {
					data: {
						code: "FooNameTaken",
						status: 409,
						title: "Conflict",
						type: "about:blank",
					},
					status: 409,
				}
			: ok(args),
	fooGet: async (...args: unknown[]) => ok(args),
	fooUpdate: async (...args: unknown[]) => ok(args),
	fooList: async (...args: unknown[]) => ok(args),
	invoiceLineCustomerAssign: async (...args: unknown[]) => ok(args),
};

if (import.meta.main) {
	// CLI_TEST_SERVERS replaces the environments, so a test can point one at its own server.
	const servers = process.env["CLI_TEST_SERVERS"];
	await cliCreate({
		document:
			servers === undefined
				? cliTestDocument
				: { ...cliTestDocument, servers: JSON.parse(servers) },
		name: "acme-app",
		operations: cliTestOperations,
	}).run(process.argv.slice(2));
}
