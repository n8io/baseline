import { logger } from "@n8io/baseline-logger";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { httpErrorHandle, httpSecureHeaders } from "./index.ts";

const appCreate = () => {
	const app = new Hono();
	app.use(httpSecureHeaders);
	app.onError(httpErrorHandle);
	app.get("/", (c) => c.text(c.get("secureHeadersNonce") ?? "no nonce"));
	app.get("/boom", () => {
		throw new Error("boom");
	});
	return app;
};

const csp = (nonce: string) =>
	`base-uri 'self'; default-src 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'nonce-${nonce}'`;

describe("httpSecureHeaders", () => {
	it("enforces a CSP whose script-src carries the request's nonce", async () => {
		const res = await appCreate().request("/");
		const nonce = await res.text();

		expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
		expect(res.headers.get("Content-Security-Policy")).toBe(csp(nonce));
	});

	it("keeps Hono's other secure headers", async () => {
		const res = await appCreate().request("/");

		expect(res.headers.get("Strict-Transport-Security")).toBe(
			"max-age=15552000; includeSubDomains",
		);
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
	});

	it("gives every request a new nonce", async () => {
		const app = appCreate();
		const first = await (await app.request("/")).text();
		const second = await (await app.request("/")).text();

		expect(first).not.toBe(second);
	});

	it("sets the headers on an error response too", async () => {
		vi.spyOn(logger, "error").mockImplementation(() => undefined);
		const res = await appCreate().request("/boom");

		expect(res.status).toBe(500);
		expect(res.headers.get("Content-Security-Policy")).toMatch(
			/^base-uri 'self'; .*script-src 'self' 'nonce-/,
		);
		vi.restoreAllMocks();
	});
});
