import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import {
	type HttpErrorStatus,
	httpErrorBody,
	httpErrorResponses,
	httpProblemHeaders,
} from "../src/index.ts";

type FooError =
	| { type: "FooNotFound" }
	| { type: "FooNameTaken" }
	| { type: "FooForbidden" }
	| { type: "FooArchived" };
const fooErrorStatus = {
	FooArchived: 409,
	FooForbidden: 403,
	FooNameTaken: 409,
	FooNotFound: 404,
} as const satisfies HttpErrorStatus<FooError>;

describe("httpErrorBody", () => {
	it("returns status, the reason phrase as title and the error's type as code, never its message", () => {
		const error = Object.assign(new Error("canary@example.com is taken"), {
			type: "FooNameTaken",
		});

		expect(httpErrorBody(error, 409)).toStrictEqual({
			code: "FooNameTaken",
			status: 409,
			title: "Conflict",
		});
		expect(httpProblemHeaders).toStrictEqual({
			"Content-Type": "application/problem+json",
		});
	});
});

describe("httpErrorResponses", () => {
	it("builds one problem+json entry per status, listing the types that answer with it", () => {
		const responses = httpErrorResponses(fooErrorStatus, [
			"FooNameTaken",
			"FooArchived",
			"FooNotFound",
		]);

		expect(Object.keys(responses)).toStrictEqual(["404", "409"]);
		expect(responses[409]).toMatchObject({
			description: "FooNameTaken, FooArchived",
		});
		expect(responses[404]).toMatchObject({ description: "FooNotFound" });
	});

	it("documents the problem schema with only the listed codes in the OpenAPI document", () => {
		const route = createRoute({
			method: "post",
			path: "/foos",
			responses: {
				201: { description: "Created" },
				...httpErrorResponses(fooErrorStatus, ["FooNameTaken"]),
			},
		});
		const app = new OpenAPIHono().openapi(route, (c) => c.body(null, 201));
		const doc = app.getOpenAPI31Document({
			info: { title: "test", version: "1" },
			openapi: "3.1.0",
		});
		const conflict = doc.paths?.["/foos"]?.post?.responses?.["409"];

		expect(conflict).toMatchObject({
			content: {
				"application/problem+json": {
					schema: {
						properties: {
							code: { enum: ["FooNameTaken"], type: "string" },
							status: { type: "integer" },
						},
						required: ["status", "title", "code"],
					},
				},
			},
			description: "FooNameTaken",
		});
	});

	it("type-checks the listed types against the status table", () => {
		// @ts-expect-error "FooNameTakn" is not a key of the table
		const responses = httpErrorResponses(fooErrorStatus, ["FooNameTakn"]);

		expect(Object.keys(responses)).toStrictEqual(["undefined"]);
	});

	it("lets a handler return the problem body with a listed status, and only those", async () => {
		// Every response has content, so Hono checks the handler's statuses strictly.
		const route = createRoute({
			method: "post",
			path: "/foos",
			responses: {
				201: {
					content: { "application/json": { schema: z.object({}) } },
					description: "Created",
				},
				...httpErrorResponses(fooErrorStatus, ["FooNameTaken", "FooNotFound"]),
			},
		});
		const error = { type: "FooNameTaken" } as const;
		const app = new OpenAPIHono().openapi(route, (c) => {
			const status = fooErrorStatus[error.type];
			return c.json(httpErrorBody(error, status), status, httpProblemHeaders);
		});
		new OpenAPIHono().openapi(
			route,
			// @ts-expect-error 403 is not listed for this route
			(c) => c.json(httpErrorBody(error, 403), 403, httpProblemHeaders),
		);

		const res = await app.request("/foos", { method: "POST" });

		expect(res.status).toBe(409);
		expect(res.headers.get("Content-Type")).toBe("application/problem+json");
	});
});
