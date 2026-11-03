import type { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Builds the real server.ts app without serving it: no React Router build, no health port.
vi.mock("react-router-hono-server/node", () => ({
	createHonoServer: async (options: unknown) => options,
}));
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
});
