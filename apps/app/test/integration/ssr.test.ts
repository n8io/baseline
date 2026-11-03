import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import {
	type ProductionServer,
	productionServerStart,
	type SignedIn,
	signIn,
} from "./production-server.ts";

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

const notFound = async (headers: Record<string, string>): Promise<string> => {
	const res = await fetch(`${server.url}/no-such-page`, {
		headers,
		redirect: "manual",
	});
	expect(res.status).toBe(404);
	expect(res.headers.get("content-type")).toMatch(/^text\/html/);
	return res.text();
};

describe("server-rendered pages on the production build", {
	timeout: 30_000,
}, () => {
	it("renders an unknown page as the root error boundary's 404", async () => {
		const html = await notFound({ cookie: session.cookie });

		expect(html).toMatch(/^<!DOCTYPE html>/i);
		expect(html).toMatch(/<h1[^>]*>404 Not Found<\/h1>/);
		expect(html).toContain("This page does not exist.");
		expect(html).toMatch(/<script[^>]*type="module"/);
	});

	it("renders the same 404 signed out", async () => {
		expect(await notFound({})).toContain("This page does not exist.");
	});

	it("serves the memory issuer's sign-in page as HTML", async () => {
		const res = await fetch(`${server.url}/auth/sign-in`);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/^text\/html/);
		expect(await res.text()).toMatch(/<form[^>]*action="\/auth\/sign-in"/);
	});
});
