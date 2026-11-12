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

beforeAll(async () => {
	const server = (await import("./server.ts")).default as unknown as {
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
		const res = await app.request("/api/v1/nothing-here", {
			headers: await bearer(),
		});
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({
			code: "NotFound",
			status: 404,
			title: "Not Found",
		});
	});

	it("skips the cookie middleware on /api, but runs it on pages", async () => {
		const cookie = { Cookie: "__Host-authn=not-a-real-token" };
		const api = await app.request("/api/v1/nothing-here", {
			headers: { ...(await bearer()), ...cookie },
		});
		expect(api.status).toBe(404);
		expect(api.headers.get("set-cookie")).toBeNull();

		const page = await app.request("/wiring/boom", { headers: cookie });
		expect(page.status).toBe(302);
		expect(page.headers.get("location")).toMatch(/^\/auth\/sign-in\?returnTo=/);
	});

	describe("cross-site requests", () => {
		const evil = { Origin: "https://evil.example" };

		it("refuses a cross-site sign-out with a 403 problem", async () => {
			const res = await app.request("/auth/sign-out", {
				headers: evil,
				method: "POST",
			});
			expect(res.status).toBe(403);
			expect(res.headers.get("content-type")).toBe("application/problem+json");
			expect(await res.json()).toMatchObject({ code: "Forbidden" });
		});

		it("refuses a cross-site form post to a page", async () => {
			const res = await app.request("/foos", {
				body: new URLSearchParams({ name: "forged" }),
				headers: evil,
				method: "POST",
			});
			expect(res.status).toBe(403);
		});

		it("signs out from the same origin", async () => {
			const res = await app.request("/auth/sign-out", {
				headers: { Origin: "http://localhost" },
				method: "POST",
			});
			expect(res.status).toBe(302);
		});

		it("leaves bearer requests to /api alone, whatever their Origin", async () => {
			const json = await app.request("/api/v1/foos", {
				body: JSON.stringify({ name: "from another origin" }),
				headers: { ...(await bearer()), ...evil },
				method: "POST",
			});
			expect(json.status).toBe(201);

			const form = await app.request("/api/v1/foos", {
				body: new URLSearchParams({ name: "form" }),
				headers: { Authorization: (await bearer()).Authorization, ...evil },
				method: "POST",
			});
			expect(form.status).not.toBe(403);
		});
	});

	it("rejects an invalid bearer token on /api/v1 with 401", async () => {
		const res = await app.request("/api/v1/nothing-here", {
			headers: { Authorization: "Bearer not-a-real-token" },
		});
		expect(res.status).toBe(401);
	});

	describe("foo API", () => {
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

		it("answers 401 without a token before validating the body", async () => {
			const res = await app.request("/api/v1/foos", {
				body: JSON.stringify({ unknown: true }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			});
			expect(res.status).toBe(401);
			expect(res.headers.get("content-type")).toBe("application/problem+json");
			expect(await res.json()).toMatchObject({ code: "AuthnRequired" });
		});

		it("validates the body once the request has an actor", async () => {
			const res = await app.request("/api/v1/foos", {
				body: JSON.stringify({ unknown: true }),
				headers: await bearer(),
				method: "POST",
			});
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ code: "ValidationFailed" });
		});

		it("serves the OpenAPI document without a token", async () => {
			const res = await app.request("/api/v1/openapi.json");
			expect(res.status).toBe(200);
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

	describe("foo live updates", () => {
		const cookieSignIn = async () => {
			const res = await app.request("/auth/sign-in", {
				body: new URLSearchParams({ who: "user" }),
				headers: { Origin: "http://localhost" },
				method: "POST",
			});
			expect(res.status).toBe(302);
			return res.headers
				.getSetCookie()
				.map((cookie) => cookie.split(";")[0])
				.join("; ");
		};

		it("sends a live update to an open detail stream when the foo is updated", async () => {
			const token = await authnMemoryTokenCreate(authn as Authn, {
				id: "user-1",
				kind: "user",
				scopes: [],
			});
			const headers = {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			};
			const created = await app.request("/api/v1/foos", {
				body: JSON.stringify({ name: "live" }),
				headers,
				method: "POST",
			});
			const foo = (await created.json()) as { id: string };

			const live = await app.request(`/live/foo/${foo.id}`, {
				headers: { Cookie: await cookieSignIn() },
			});
			expect(live.status).toBe(200);
			const reader = (live.body as ReadableStream<Uint8Array>).getReader();
			const decoder = new TextDecoder();
			let body = "";
			const until = async (text: string) => {
				while (!body.includes(text)) {
					const chunk = await reader.read();
					if (chunk.done) throw new Error(`stream ended before ${text}`);
					body += decoder.decode(chunk.value, { stream: true });
				}
			};
			try {
				await until("event: ready");
				const updated = await app.request(`/api/v1/foos/${foo.id}`, {
					body: JSON.stringify({ name: "live-renamed" }),
					headers,
					method: "PATCH",
				});
				expect(updated.status).toBe(200);
				await until("foo.updated");
				expect(body).toContain(
					`data: ${JSON.stringify({ id: foo.id, type: "foo.updated" })}`,
				);
			} finally {
				await reader.cancel();
			}
		});

		it("reads only the cookie: a bearer token gets 401", async () => {
			const token = await authnMemoryTokenCreate(authn as Authn, {
				id: "user-1",
				kind: "user",
				scopes: [],
			});
			const res = await app.request(
				"/live/foo/foo_01m6gtefj7e9bayj0wmqpjjmg8",
				{
					headers: { Authorization: `Bearer ${token}` },
				},
			);
			expect(res.status).toBe(401);
		});
	});
});
