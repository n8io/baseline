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

const formPost = (path: string, headers: Record<string, string>) =>
	fetch(`${server.url}${path}`, {
		body: new URLSearchParams({ who: "admin" }),
		headers: { cookie: session.cookie, ...headers },
		method: "POST",
		redirect: "manual",
	});

const crossSite = {
	origin: "https://evil.example",
	"sec-fetch-site": "cross-site",
};

// Uses only routes every project has; foo-ssr.test.ts covers a foo page action.
describe("cross-site requests to cookie routes on the production build", {
	timeout: 30_000,
}, () => {
	it("answers a cross-site sign-out with a 403 problem and keeps the cookies", async () => {
		const res = await formPost("/auth/sign-out", crossSite);

		expect(res.status).toBe(403);
		expect(res.headers.get("content-type")).toBe("application/problem+json");
		expect(await res.json()).toEqual({
			code: "Forbidden",
			status: 403,
			title: "Forbidden",
		});
		expect(res.headers.get("set-cookie")).toBeNull();
	});

	// piece-start: ui
	it("refuses a cross-site post to a page or a React Router data request", async () => {
		for (const path of ["/no-such-page", "/no-such-page.data"]) {
			const res = await formPost(path, crossSite);
			expect(res.status).toBe(403);
			expect(res.headers.get("content-type")).toBe("application/problem+json");
		}
	});

	it("passes a same-origin page post and data request through to React Router", async () => {
		for (const path of ["/no-such-page", "/no-such-page.data"]) {
			const res = await formPost(path, { "sec-fetch-site": "same-origin" });
			expect(res.status).not.toBe(403);
			await res.body?.cancel();
		}
	});
	// piece-end: ui

	it("signs in behind a TLS proxy that sets x-forwarded-proto", async () => {
		const res = await formPost("/auth/sign-in", {
			origin: server.url.replace("http:", "https:"),
			"x-forwarded-proto": "https",
		});

		expect(res.status).toBe(302);
		expect(res.headers.getSetCookie().join("\n")).toContain("__Host-authn=");
	});

	it("signs out from the same origin", async () => {
		const res = await formPost("/auth/sign-out", { origin: server.url });

		expect(res.status).toBe(302);
		expect(res.headers.getSetCookie().join("\n")).toContain("__Host-authn=;");
	});
});
