import { type Authn, authnMemoryTokenCreate } from "@n8io/baseline-authn";
import type { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Builds the real server.ts app without serving it: no React Router build, no health port.
vi.mock("react-router-hono-server/node", () => ({
	createHonoServer: async (options: unknown) => options,
}));
let authn: Authn | undefined;
vi.mock("@n8io/baseline-authn", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("@n8io/baseline-authn")>();
	return {
		...original,
		authnCreate: async (...args: Parameters<typeof original.authnCreate>) => {
			authn = await original.authnCreate(...args);
			return authn;
		},
	};
});
vi.mock("@n8io/baseline-health", () => ({
	healthServerCreate: () => ({ close: async () => {}, ready: () => {} }),
}));

let app: Hono;

beforeAll(async () => {
	const server = (await import("../../src/server.ts")).default as unknown as {
		app: Hono;
	};
	app = server.app;
	app.get("/wiring/boom", () => {
		throw new Error("boom");
	});
});

describe("server wiring", () => {
	it("answers a throwing route with a 500 problem body", async () => {
		const res = await app.request("/wiring/boom");
		expect(res.status).toBe(500);
		expect(res.headers.get("content-type")).toBe("application/problem+json");
		expect(await res.json()).toEqual({
			code: "InternalError",
			status: 500,
			title: "Internal Server Error",
		});
	});

	it("answers an unknown /api path with JSON, before any page", async () => {
		const res = await app.request("/api/v1/nothing-here");
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({
			code: "NotFound",
			status: 404,
			title: "Not Found",
		});
	});

	it("skips the cookie middleware on /api, but runs it on pages", async () => {
		const cookie = { Cookie: "__Host-authn=not-a-real-token" };
		const api = await app.request("/api/v1/nothing-here", { headers: cookie });
		expect(api.status).toBe(404);
		expect(api.headers.get("set-cookie")).toBeNull();

		const page = await app.request("/wiring/boom", { headers: cookie });
		expect(page.status).toBe(302);
		expect(page.headers.get("location")).toMatch(/^\/auth\/sign-in\?returnTo=/);
	});

	it("rejects an invalid bearer token on /api/v1 with 401", async () => {
		const res = await app.request("/api/v1/nothing-here", {
			headers: { Authorization: "Bearer not-a-real-token" },
		});
		expect(res.status).toBe(401);
	});

	describe("foo API", () => {
		const bearer = async () => {
			if (!authn) throw new Error("authn was not captured");
			const token = await authnMemoryTokenCreate(authn, {
				id: "user-1",
				kind: "user",
				scopes: [],
			});
			return {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			};
		};

		it("creates a foo and reads it back with a bearer token", async () => {
			const headers = await bearer();
			const created = await app.request("/api/v1/foos", {
				body: JSON.stringify({ name: "wired" }),
				headers,
				method: "POST",
			});
			expect(created.status).toBe(201);
			const foo = (await created.json()) as { id: string };

			const got = await app.request(`/api/v1/foos/${foo.id}`, { headers });
			expect(got.status).toBe(200);
			expect(await got.json()).toStrictEqual(foo);
		});

		it("answers 401 without a token", async () => {
			const res = await app.request("/api/v1/foos");
			expect(res.status).toBe(401);
		});

		it("documents the foo routes in the OpenAPI document", async () => {
			const res = await app.request("/api/v1/openapi.json");
			expect(res.status).toBe(200);
			const doc = (await res.json()) as {
				components: { schemas: Record<string, unknown> };
				paths: Record<string, Record<string, { responses: object }>>;
			};

			expect(Object.keys(doc.paths["/api/v1/foos"] ?? {})).toEqual(
				expect.arrayContaining(["get", "post"]),
			);
			expect(Object.keys(doc.paths["/api/v1/foos/{fooId}"] ?? {})).toEqual(
				expect.arrayContaining(["get", "patch", "delete"]),
			);
			expect(
				Object.keys(doc.paths["/api/v1/foos/{fooId}"]?.patch?.responses ?? {}),
			).toEqual(expect.arrayContaining(["200", "403", "404", "409"]));
			expect(Object.keys(doc.components.schemas)).toContain("FooResponse");
		});
	});
});
