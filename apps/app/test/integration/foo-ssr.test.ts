import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import { integrationSignIn, type SignedIn } from "./integration-sign-in.ts";
import {
	type ProductionServer,
	productionServerStart,
} from "./production-server.ts";

let server: ProductionServer;
let drop: () => Promise<void>;
let session: SignedIn;

beforeAll(async () => {
	const database = await integrationDatabaseCreate();
	drop = database.drop;
	server = await productionServerStart({
		databaseUrl: database.databaseUrl,
	});
	session = await integrationSignIn(server.url);
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

describe("server-rendered foo pages on the production build", {
	timeout: 30_000,
}, () => {
	it("renders the list page and its create form as HTML", async () => {
		const res = await page("/foos");

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/^text\/html/);
		const html = await res.text();
		expect(html).toMatch(/<h1[^>]*>Foos<\/h1>/);
		expect(html).toMatch(/<form[^>]*action="\/foos"[^>]*method="post"/);
		expect(html).toContain('name="name"');
	});

	it("creates a foo from a plain form post and renders it on both pages", async () => {
		const created = await fetch(`${server.url}/foos`, {
			body: new URLSearchParams({ name: "Rendered on the server" }),
			headers: { cookie: session.cookie, origin: server.url },
			method: "POST",
			redirect: "manual",
		});

		expect(created.status).toBe(302);
		const location = created.headers.get("location") ?? "";
		expect(location).toMatch(/^\/foos\/foo_[0-9a-z]{26}$/);
		const detail = await page(location);
		expect(detail.status).toBe(200);
		expect(await detail.text()).toContain("Rendered on the server");
		expect(await (await page("/foos")).text()).toContain(
			"Rendered on the server",
		);
	});

	it("refuses a cross-site form post to the create action and creates nothing", async () => {
		const name = "Posted from another site";
		const res = await fetch(`${server.url}/foos`, {
			body: new URLSearchParams({ name }),
			headers: { cookie: session.cookie, origin: "https://evil.example" },
			method: "POST",
			redirect: "manual",
		});

		expect(res.status).toBe(403);
		expect(res.headers.get("content-type")).toBe("application/problem+json");
		expect(await (await page("/foos")).text()).not.toContain(name);
	});

	it("redirects a signed-out page load to sign-in", async () => {
		const res = await fetch(`${server.url}/foos`, { redirect: "manual" });

		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe("/auth/sign-in?returnTo=%2Ffoos");
	});
});
