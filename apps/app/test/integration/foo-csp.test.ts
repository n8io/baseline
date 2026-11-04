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

const page = (path: string) =>
	fetch(`${server.url}${path}`, {
		headers: { cookie: session.cookie },
		redirect: "manual",
	});

describe("security headers on the production build's foo pages", {
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
			nonces.push(scriptsNonce(res, await res.text()));
		}
		expect(nonces[0]).not.toBe(nonces[1]);
	});
});
