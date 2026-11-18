import { existsSync, readdirSync } from "node:fs";
import { authnMemoryTokenFetch } from "@n8io/baseline-authn";
import { liveTestSseRead } from "@n8io/baseline-live/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type ProductionServer,
	productionServerStart,
} from "./production-server.ts";

// The production build on memory adapters, driven over HTTP.
let server: ProductionServer;

beforeAll(async () => {
	server = await productionServerStart({ databaseUrl: "memory://" });
}, 30_000);

afterAll(async () => {
	await server?.stop();
});

// A manual redirect keeps a 302 and its Set-Cookie visible.
const request = (path: string, init: RequestInit = {}) =>
	fetch(`${server.url}${path}`, { redirect: "manual", ...init });

const bearer = async () => {
	const { authorization } = await authnMemoryTokenFetch({
		clientId: "dev-client",
		url: server.url,
	});
	return { Authorization: authorization, "Content-Type": "application/json" };
};

describe("server wiring", { timeout: 30_000 }, () => {
	it("answers an unknown /api path with JSON, before any page", async () => {
		const res = await request("/api/v1/nothing-here", {
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
		const api = await request("/api/v1/nothing-here", {
			headers: { ...(await bearer()), ...cookie },
		});
		expect(api.status).toBe(404);
		expect(api.headers.get("set-cookie")).toBeNull();

		const page = await request("/any-page", { headers: cookie });
		expect(page.status).toBe(302);
		expect(page.headers.get("location")).toMatch(/^\/auth\/sign-in\?returnTo=/);
	});

	describe("cross-site requests", () => {
		const evil = { Origin: "https://evil.example" };

		it("refuses a cross-site sign-out with a 403 problem", async () => {
			const res = await request("/auth/sign-out", {
				headers: evil,
				method: "POST",
			});
			expect(res.status).toBe(403);
			expect(res.headers.get("content-type")).toBe("application/problem+json");
			expect(await res.json()).toMatchObject({ code: "Forbidden" });
		});

		it("refuses a cross-site form post to a page", async () => {
			const res = await request("/any-page", {
				body: new URLSearchParams({ name: "forged" }),
				headers: evil,
				method: "POST",
			});
			expect(res.status).toBe(403);
		});

		it("signs out from the same origin", async () => {
			const res = await request("/auth/sign-out", {
				headers: { Origin: server.url },
				method: "POST",
			});
			expect(res.status).toBe(302);
		});
	});

	it("rejects an invalid bearer token on /api/v1 with 401", async () => {
		const res = await request("/api/v1/nothing-here", {
			headers: { Authorization: "Bearer not-a-real-token" },
		});
		expect(res.status).toBe(401);
	});

	// Every guard below sits in base code, outside any piece block and any Domain, so a Project
	// runs these too. test/render/api-only.ts checks the main ones on a Project with every piece removed.
	describe("security guards in every piece combination", () => {
		const evil = { Origin: "https://evil.example" };
		const cspStart =
			/^base-uri 'self'; default-src 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'nonce-/;

		it("sends the CSP and the secure headers on every kind of response", async () => {
			const responses = {
				401: await request("/api/v1/nothing-here"),
				403: await request("/auth/sign-out", {
					headers: evil,
					method: "POST",
				}),
				404: await request("/api/v1/nothing-here", {
					headers: await bearer(),
				}),
				openapi: await request("/api/v1/openapi.json"),
				signInPage: await request("/auth/sign-in"),
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
				const res = await request(path, {
					body: new URLSearchParams({ who: "dev-admin" }),
					headers: evil,
					method: "POST",
				});
				expect(res.status).toBe(403);
				expect(res.headers.get("set-cookie")).toBeNull();
			},
		);

		it("sets the session cookie as __Host-: Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain", async () => {
			const res = await request("/auth/sign-in", {
				body: new URLSearchParams({ who: "dev-user" }),
				headers: { Origin: server.url },
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
			const doc = (await (await request("/api/v1/openapi.json")).json()) as {
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
				const res = await request(path, {
					body: method === "GET" ? null : "{not json",
					headers: { "Content-Type": "application/json" },
					method,
				});
				expect(res.status, `${method} ${path}`).toBe(401);
				expect(await res.json()).toMatchObject({ code: "AuthnRequired" });
			}
		});

		it("serves the OpenAPI document without a token", async () => {
			const res = await request("/api/v1/openapi.json");
			expect(res.status).toBe(200);
		});

		// SDK methods and CLI commands are named from these two fields (docs/agents/api.md).
		it("names every operation after its Use case and tags it with its Domain", async () => {
			const doc = (await (await request("/api/v1/openapi.json")).json()) as {
				paths: Record<
					string,
					Record<string, { operationId?: string; tags?: string[] }>
				>;
			};
			const folder = new URL("../../src/domains", import.meta.url);
			const domains = (
				existsSync(folder) ? readdirSync(folder, { withFileTypes: true }) : []
			)
				.filter((entry) => entry.isDirectory())
				.map(({ name }) =>
					name.replace(/-(.)/g, (_, c: string) => c.toUpperCase()),
				);
			const operations = Object.entries(doc.paths).flatMap(([path, methods]) =>
				Object.entries(methods).map(([method, operation]) => ({
					at: `${method.toUpperCase()} ${path}`,
					...operation,
				})),
			);
			for (const { at, operationId, tags } of operations) {
				expect(tags, at).toHaveLength(1);
				const tag = tags?.[0] ?? "";
				expect(domains, at).toContain(tag);
				expect(operationId?.startsWith(tag), `${at}: ${operationId}`).toBe(
					true,
				);
				expect(operationId?.charAt(tag.length) ?? "", at).toMatch(/[A-Z]/);
			}
			const ids = operations.map(({ operationId }) => operationId);
			expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
		});

		it("declares the bearer scheme and requires it on every operation", async () => {
			const doc = (await (await request("/api/v1/openapi.json")).json()) as {
				components: { securitySchemes: Record<string, unknown> };
				security: unknown;
			};

			expect(doc.components.securitySchemes).toEqual({
				bearer: { bearerFormat: "JWT", scheme: "bearer", type: "http" },
			});
			expect(doc.security).toEqual([{ bearer: [] }]);
		});

		it("leaves bearer requests to /api alone, whatever their Origin", async () => {
			const res = await request("/api/v1/nothing-here", {
				body: new URLSearchParams({ name: "form" }),
				headers: {
					Authorization: (await bearer()).Authorization,
					Origin: "https://evil.example",
				},
				method: "POST",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("foo API", () => {
		it("creates a foo and reads it back with a bearer token", async () => {
			const headers = await bearer();
			const created = await request("/api/v1/foos", {
				body: JSON.stringify({ name: "wired" }),
				headers,
				method: "POST",
			});
			expect(created.status).toBe(201);
			const foo = (await created.json()) as { id: string };

			const got = await request(`/api/v1/foos/${foo.id}`, { headers });
			expect(got.status).toBe(200);
			expect(await got.json()).toStrictEqual(foo);
		});

		it("leaves bearer requests to /api alone, whatever their Origin", async () => {
			const json = await request("/api/v1/foos", {
				body: JSON.stringify({ name: "from another origin" }),
				headers: { ...(await bearer()), Origin: "https://evil.example" },
				method: "POST",
			});
			expect(json.status).toBe(201);

			const form = await request("/api/v1/foos", {
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
			const res = await request("/api/v1/foos");
			expect(res.status).toBe(401);
		});

		it("answers 401 without a token before validating the body", async () => {
			const res = await request("/api/v1/foos", {
				body: JSON.stringify({ unknown: true }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			});
			expect(res.status).toBe(401);
			expect(res.headers.get("content-type")).toBe("application/problem+json");
			expect(await res.json()).toMatchObject({ code: "AuthnRequired" });
		});

		it("validates the body once the request has an actor", async () => {
			const res = await request("/api/v1/foos", {
				body: JSON.stringify({ unknown: true }),
				headers: await bearer(),
				method: "POST",
			});
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ code: "ValidationFailed" });
		});

		it("documents the foo routes in the OpenAPI document", async () => {
			const res = await request("/api/v1/openapi.json");
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
			const res = await request("/auth/sign-in", {
				body: new URLSearchParams({ who: "dev-user" }),
				headers: { Origin: server.url },
				method: "POST",
			});
			expect(res.status).toBe(302);
			return res.headers
				.getSetCookie()
				.map((cookie) => cookie.split(";")[0])
				.join("; ");
		};

		it("sends a live update to an open detail stream when the foo is updated", async () => {
			const headers = await bearer();
			const created = await request("/api/v1/foos", {
				body: JSON.stringify({ name: "live" }),
				headers,
				method: "POST",
			});
			const foo = (await created.json()) as { id: string };

			const live = await request(`/live/foo/${foo.id}`, {
				headers: { Cookie: await cookieSignIn() },
			});
			expect(live.status).toBe(200);
			const sse = liveTestSseRead({ response: live });
			try {
				await sse.until("event: ready");
				const updated = await request(`/api/v1/foos/${foo.id}`, {
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
			const res = await request("/live/foo/foo_01m6gtefj7e9bayj0wmqpjjmg8", {
				headers: { Authorization: (await bearer()).Authorization },
			});
			expect(res.status).toBe(401);
		});
	});
});
