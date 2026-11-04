import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import {
	type ProductionServer,
	productionServerStart,
} from "./production-server.ts";
import { type SignedIn, signIn } from "./sign-in.ts";

let server: ProductionServer;
let drop: () => Promise<void>;
let session: SignedIn;

beforeAll(async () => {
	const database = await integrationDatabaseCreate();
	drop = database.drop;
	server = await productionServerStart({
		cacheUrl: inject("integrationCacheUrl"),
		databaseUrl: database.databaseUrl,
	});
	session = await signIn(server.url);
}, 30_000);

afterAll(async () => {
	await server?.stop();
	await drop?.();
});

const page = (path: string) =>
	fetch(`${server.url}${path}`, {
		headers: { cookie: session.cookie },
		redirect: "manual",
	});

// The page's CSP nonce, after checking every <script> tag carries it.
const scriptsNonce = (res: Response, html: string): string => {
	const csp = res.headers.get("content-security-policy") ?? "";
	const nonce = /script-src 'self' 'nonce-([^']+)'/.exec(csp)?.[1];
	expect(nonce).toBeDefined();
	const scripts = html.match(/<script\b[^>]*>/g) ?? [];
	expect(scripts.length).toBeGreaterThan(0);
	for (const script of scripts) {
		expect(script).toContain(` nonce="${nonce}"`);
	}
	return nonce ?? "";
};

describe("security headers on the production build", {
	timeout: 30_000,
}, () => {
	it("enforces the CSP on the foo list and detail pages, with the nonce on every script", async () => {
		const created = await fetch(`${server.url}/foos`, {
			body: new URLSearchParams({ name: "Under a CSP" }),
			headers: { cookie: session.cookie },
			method: "POST",
			redirect: "manual",
		});
		const detailPath = created.headers.get("location") ?? "";
		expect(detailPath).toMatch(/^\/foos\/foo_/);

		const nonces: string[] = [];
		for (const path of ["/foos", detailPath]) {
			const res = await page(path);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-security-policy")).toMatch(
				/^base-uri 'self'; default-src 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'nonce-/,
			);
			expect(res.headers.get("strict-transport-security")).toContain(
				"max-age=",
			);
			nonces.push(scriptsNonce(res, await res.text()));
		}
		expect(nonces[0]).not.toBe(nonces[1]);
	});

	it("answers a body over 1 MB on the API with a 413 problem", async () => {
		const res = await fetch(`${server.url}/api/v1/foos`, {
			body: JSON.stringify({ name: "x".repeat(2 * 1024 * 1024) }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});

		expect(res.status).toBe(413);
		expect(res.headers.get("content-type")).toBe("application/problem+json");
		expect(await res.json()).toMatchObject({
			code: "PayloadTooLarge",
			status: 413,
		});
	});
});
