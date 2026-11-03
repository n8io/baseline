import { createRoute, z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { httpErrorHandle, httpRouterCreate } from "../src/index.ts";

const canary = "canary@example.com";

const FooCreateBody = z.strictObject({
	email: z.email(),
	name: z.string().min(3),
	"a/b~c": z.number().optional(),
	tags: z.array(z.string()).optional(),
});

const fooCreateRoute = createRoute({
	method: "post",
	path: "/foos",
	request: {
		body: { content: { "application/json": { schema: FooCreateBody } } },
	},
	responses: { 201: { description: "Created" } },
});

const appCreate = () => {
	const app = httpRouterCreate().openapi(fooCreateRoute, (c) =>
		c.body(null, 201),
	);
	app.onError(httpErrorHandle);
	return app;
};

const post = (body: string) =>
	appCreate().request("/foos", {
		body,
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});

describe("httpRouterCreate", () => {
	it("passes a valid body through to the handler", async () => {
		const res = await post(
			JSON.stringify({ email: "a@example.com", name: "Alpha" }),
		);

		expect(res.status).toBe(201);
	});

	it("answers 400 ValidationFailed with a JSON Pointer and Zod's message per issue", async () => {
		const res = await post(
			JSON.stringify({
				email: canary.replace("@", ""),
				"a/b~c": "x",
				name: "ab",
				tags: [7],
			}),
		);

		expect(res.status).toBe(400);
		expect(res.headers.get("Content-Type")).toBe("application/problem+json");
		expect(await res.json()).toStrictEqual({
			code: "ValidationFailed",
			errors: [
				{ detail: "Invalid email address", pointer: "/email" },
				{
					detail: "Too small: expected string to have >=3 characters",
					pointer: "/name",
				},
				{
					detail: "Invalid input: expected number, received string",
					pointer: "/a~1b~0c",
				},
				{
					detail: "Invalid input: expected string, received number",
					pointer: "/tags/0",
				},
			],
			status: 400,
			title: "Bad Request",
		});
	});

	it("never echoes the input, including unrecognized key names", async () => {
		const res = await post(
			JSON.stringify({
				email: canary,
				name: canary.slice(0, 2),
				[canary]: canary,
			}),
		);
		const text = await res.text();

		expect(res.status).toBe(400);
		expect(text).not.toContain(canary);
		expect(text).not.toContain(canary.slice(0, 2));
		expect(JSON.parse(text)).toMatchObject({
			errors: [
				{
					detail: "Too small: expected string to have >=3 characters",
					pointer: "/name",
				},
				{ detail: "Unrecognized key", pointer: "" },
			],
		});
	});

	it("answers a body that is not JSON with 400 ValidationFailed", async () => {
		const res = await post(`{"name": "${canary}"`);

		expect(res.status).toBe(400);
		expect(await res.json()).toStrictEqual({
			code: "ValidationFailed",
			status: 400,
			title: "Bad Request",
		});
	});

	it("answers a body with the wrong Content-Type with 415 UnsupportedMediaType", async () => {
		const res = await appCreate().request("/foos", {
			body: JSON.stringify({ email: canary, name: "Alpha" }),
			headers: { "Content-Type": "text/plain" },
			method: "POST",
		});

		expect(res.status).toBe(415);
		expect(await res.json()).toStrictEqual({
			code: "UnsupportedMediaType",
			status: 415,
			title: "Unsupported Media Type",
		});
	});
});

describe("Zod 4 issues (V17)", () => {
	it("leave the input out unless reportInput is set", () => {
		const schema = z.object({ email: z.email(), name: z.string().min(3) });
		const input = { email: "not-an-email", name: "ab" };
		const issues = schema.safeParse(input).error?.issues ?? [];
		const reported =
			schema.safeParse(input, { reportInput: true }).error?.issues ?? [];

		expect(issues).toHaveLength(2);
		for (const issue of issues) expect(issue).not.toHaveProperty("input");
		expect(reported.map((issue) => issue.input)).toStrictEqual([
			"not-an-email",
			"ab",
		]);
	});
});
