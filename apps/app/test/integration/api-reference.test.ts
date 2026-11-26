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

describe("API reference page on the production build", {
	timeout: 30_000,
}, () => {
	it("answers without a token under the unchanged CSP, with its nonce on both script tags", async () => {
		const res = await fetch(`${server.url}/api/v1/docs`);
		const html = await res.text();

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		const csp = res.headers.get("content-security-policy") ?? "";
		expect(csp).toMatch(
			/^base-uri 'self'; connect-src 'self'[^;]*; default-src 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'nonce-[^']+'/,
		);
		const nonce = /nonce-([^']+)'/.exec(csp)?.[1];
		expect(
			[...html.matchAll(/<script [^>]*nonce="([^"]+)"/g)].map((m) => m[1]),
		).toEqual([nonce, nonce]);
		expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//);
	});

	it("serves the viewer's files from this origin without a token", async () => {
		const html = await (await fetch(`${server.url}/api/v1/docs`)).text();
		for (const url of [
			/src="([^"]+\.js)"/.exec(html)?.[1],
			/href="([^"]+\.css)"/.exec(html)?.[1],
		]) {
			const res = await fetch(`${server.url}${url}`);
			expect(res.status, String(url)).toBe(200);
			expect(res.headers.get("cache-control")).toContain("immutable");
		}
	});

	it("keeps the API itself behind a token", async () => {
		const res = await fetch(`${server.url}/api/v1/nothing-here`);

		expect(res.status).toBe(401);
	});
});
