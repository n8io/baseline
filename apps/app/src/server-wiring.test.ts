import { type Authn, authnMemoryTokenCreate } from "@n8io/baseline-authn";
import { liveTestSseRead } from "@n8io/baseline-live/testing";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Imports the real server.ts app without serving it or opening a health port.
// piece-start: ui
vi.mock("react-router-hono-server/node", () => ({
	createHonoServer: async (options: unknown) => options,
}));
// piece-end: ui
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

let app: typeof import("./server.ts")["app"];

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
	app = (await import("./server.ts")).app;
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
			const res = await app.request("/any-page", {
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
	});

	it("rejects an invalid bearer token on /api/v1 with 401", async () => {
		const res = await app.request("/api/v1/nothing-here", {
			headers: { Authorization: "Bearer not-a-real-token" },
		});
		expect(res.status).toBe(401);
	});

	// Every guard below sits in base code, outside any piece block and any Domain, so a Project
	// runs these too, with every piece removed (test/render/api-only.ts runs pnpm test there).
	describe("security guards in every piece combination", () => {
		const evil = { Origin: "https://evil.example" };
		const cspStart =
			/^base-uri 'self'; default-src 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'nonce-/;

		it("sends the CSP and the secure headers on every kind of response", async () => {
			const responses = {
				401: await app.request("/api/v1/nothing-here"),
				403: await app.request("/auth/sign-out", {
					headers: evil,
					method: "POST",
				}),
				404: await app.request("/api/v1/nothing-here", {
					headers: await bearer(),
				}),
				500: await app.request("/wiring/boom"),
				openapi: await app.request("/api/v1/openapi.json"),
				signInPage: await app.request("/auth/sign-in"),
			};
			for (const [name, res] of Object.entries(responses)) {
				const headers = Object.fromEntries(res.headers);
				expect(headers, name).toMatchObject({
					"content-security-policy": expect.stringMatching(cspStart),
					"strict-transport-security": "max-age=15552000; includeSubDomains",
					"x-content-type-options": "nosniff",
					"x-frame-options": "SAMEORIGIN",
				});
			}
		});

		it.each([
			"/auth/sign-in",
			"/auth/sign-out",
			"/auth/callback",
			"/auth/refresh",
		])(
			"refuses a cross-site form post to %s and sets no cookie",
			async (path) => {
				const res = await app.request(path, {
					body: new URLSearchParams({ who: "admin" }),
					headers: evil,
					method: "POST",
				});
				expect(res.status).toBe(403);
				expect(res.headers.get("set-cookie")).toBeNull();
			},
		);

		it("sets the session cookie as __Host-: Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain", async () => {
			const res = await app.request("/auth/sign-in", {
				body: new URLSearchParams({ who: "user" }),
				headers: { Origin: "http://localhost" },
				method: "POST",
			});
			expect(res.status).toBe(302);
			const access = res.headers
				.getSetCookie()
				.find((cookie) => cookie.startsWith("__Host-authn="));
			const attributes = access?.split(/;\s*/).slice(1).sort();
			expect(attributes).toEqual([
				"HttpOnly",
				expect.stringMatching(/^Max-Age=\d+$/),
				"Path=/",
				"SameSite=Lax",
				"Secure",
			]);
		});

		it("answers every anonymous /api/v1 request with 401 before a route reads its body", async () => {
			const doc = (await (
				await app.request("/api/v1/openapi.json")
			).json()) as {
				paths: Record<string, Record<string, unknown>>;
			};
			const requests = Object.entries(doc.paths).flatMap(([path, operations]) =>
				Object.keys(operations).map((method) => ({
					method: method.toUpperCase(),
					path: `/api/v1${path.replace(/^\/api\/v1/, "").replace(/\{[^}]+\}/g, "x")}`,
				})),
			);
			requests.push({ method: "POST", path: "/api/v1/nothing-here" });
			for (const { method, path } of requests) {
				const res = await app.request(path, {
					body: method === "GET" ? null : "{not json",
					headers: { "Content-Type": "application/json" },
					method,
				});
				expect(res.status, `${method} ${path}`).toBe(401);
				expect(await res.json()).toMatchObject({ code: "AuthnRequired" });
			}
		});
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

		it("leaves bearer requests to /api alone, whatever their Origin", async () => {
			const json = await app.request("/api/v1/foos", {
				body: JSON.stringify({ name: "from another origin" }),
				headers: { ...(await bearer()), Origin: "https://evil.example" },
				method: "POST",
			});
			expect(json.status).toBe(201);

			const form = await app.request("/api/v1/foos", {
				body: new URLSearchParams({ name: "form" }),
				headers: {
					Authorization: (await bearer()).Authorization,
					Origin: "https://evil.example",
				},
				method: "POST",
			});
			expect(form.status).not.toBe(403);
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
			const sse = liveTestSseRead({ response: live });
			try {
				await sse.until("event: ready");
				const updated = await app.request(`/api/v1/foos/${foo.id}`, {
					body: JSON.stringify({ name: "live-renamed" }),
					headers,
					method: "PATCH",
				});
				expect(updated.status).toBe(200);
				expect(await sse.until("foo.updated")).toContain(
					`data: ${JSON.stringify({ id: foo.id, type: "foo.updated" })}`,
				);
			} finally {
				await sse.cancel();
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
