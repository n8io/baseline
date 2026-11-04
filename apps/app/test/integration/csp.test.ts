import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { scriptsNonce } from "./csp-nonce.ts";
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

// Uses only pages and paths every project has; foo-csp.test.ts covers the foo pages.
describe("security headers on the production build", {
	timeout: 30_000,
}, () => {
	it("enforces the CSP on a rendered page, with a new nonce on every script each time", async () => {
		const nonces: string[] = [];
		for (let i = 0; i < 2; i += 1) {
			const res = await fetch(`${server.url}/no-such-page`, {
				headers: { cookie: session.cookie },
			});
			expect(res.status).toBe(404);
			expect(res.headers.get("strict-transport-security")).toContain(
				"max-age=",
			);
			nonces.push(scriptsNonce(res, await res.text()));
		}
		expect(nonces[0]).not.toBe(nonces[1]);
	});

	it("serves the sign-in page under the CSP with no inline styles", async () => {
		const res = await fetch(`${server.url}/auth/sign-in`);

		expect(res.headers.get("content-security-policy")).toContain(
			"default-src 'self'",
		);
		expect(await res.text()).not.toContain("style=");
	});

	it("answers a body over 1 MB on the API with a 413 problem", async () => {
		const res = await fetch(`${server.url}/api/v1/no-such-resource`, {
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
