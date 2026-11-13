import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scriptsNonce } from "./csp-nonce.ts";
import { integrationDatabaseCreate } from "./integration-database.ts";
import {
	type ProductionServer,
	productionServerStart,
} from "./production-server.ts";
import { rolloutBuildCreate } from "./rollout-build.ts";

// Two pods mid-rollout: `old` serves build/, `next` a copy whose hashed files and manifest
// version differ. A browser's requests can reach either one.
let old: ProductionServer;
let next: ProductionServer;
let cleanup: () => Promise<void>;

beforeAll(async () => {
	const database = await integrationDatabaseCreate();
	const build = rolloutBuildCreate();
	cleanup = async () => {
		await Promise.all([old?.stop(), next?.stop()]);
		build[Symbol.dispose]();
		await database.drop();
	};
	const { databaseUrl } = database;
	[old, next] = await Promise.all([
		productionServerStart({ databaseUrl }),
		productionServerStart({ databaseUrl, directory: build.directory }),
	]);
}, 60_000);

afterAll(async () => {
	await cleanup?.();
});

// A page every project has, signed out: the root error boundary's 404, with the root's scripts
// and stylesheet.
const page = async (server: ProductionServer) => {
	const res = await fetch(`${server.url}/no-such-page`);
	const html = await res.text();
	const assets = [...new Set(html.match(/\/assets\/[\w.-]+/g))];
	return { assets, html, res };
};

const manifestVersion = (assets: string[]): string => {
	const version = assets
		.map((asset) => /\/manifest-(\w+)\.js$/.exec(asset)?.[1])
		.find((found) => found !== undefined);
	if (version === undefined) throw new Error("the page names no manifest");
	return version;
};

const routesDiscover = (server: ProductionServer, version: string) =>
	fetch(`${server.url}/__manifest?paths=%2F&version=${version}`);

describe("pods of two UI versions during a rolling deploy", {
	timeout: 30_000,
}, () => {
	it("answers a hashed file only the other version has with a 404 nothing may cache", async () => {
		const { assets } = await page(old);
		expect(assets.some((asset) => asset.endsWith(".css"))).toBe(true);
		expect(assets.some((asset) => asset.includes("/entry.client-"))).toBe(true);

		for (const asset of assets) {
			const own = await fetch(`${old.url}${asset}`);
			await own.body?.cancel();
			expect(own.status, asset).toBe(200);
			expect(own.headers.get("cache-control"), asset).toBe(
				"public, max-age=31536000",
			);

			const other = await fetch(`${next.url}${asset}`);
			expect(other.status, asset).toBe(404);
			expect(other.headers.get("cache-control"), asset).toBe("no-store");
			// Not a rendered page, and not a redirect to sign-in.
			expect(other.headers.get("content-type"), asset).toMatch(/^text\/plain/);
			expect(await other.text(), asset).toBe("Not Found");
		}
	});

	it("ends a navigation that crosses versions on a working page", async () => {
		const before = await page(old);
		const version = manifestVersion(before.assets);

		// The old page's router asks for the routes of its next page and reaches the new pod.
		// This answer is what makes React Router load the page afresh instead of failing.
		const crossed = await routesDiscover(next, version);
		expect(crossed.status).toBe(204);
		expect(crossed.headers.get("x-remix-reload-document")).toBe("true");
		const same = await routesDiscover(old, version);
		await same.body?.cancel();
		expect(same.status).toBe(200);

		// The fresh load: the new pod's page names only files the new pod has.
		const after = await page(next);
		expect(manifestVersion(after.assets)).not.toBe(version);
		expect(after.assets).toHaveLength(before.assets.length);
		for (const asset of after.assets) {
			expect(before.assets).not.toContain(asset);
			const res = await fetch(`${next.url}${asset}`);
			await res.body?.cancel();
			expect(res.status, asset).toBe(200);
		}
	});

	it("renders the script that reloads the page once when its own files fail to load", async () => {
		const { html, res } = await page(old);
		const nonce = scriptsNonce(res, html);

		// In <head> before the stylesheet, so it is listening when that fails to load.
		const script = html.indexOf(`<script nonce="${nonce}">(() => {`);
		expect(script).toBeGreaterThan(html.indexOf("<head>"));
		expect(script).toBeLessThan(html.indexOf('rel="stylesheet"'));
		const source = html.slice(script, html.indexOf("</script>", script));
		expect(source).toContain("/assets/");
		expect(source).toContain("window.location.reload()");
	});
});
