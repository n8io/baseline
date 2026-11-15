import { httpRouterCreate, httpSecureHeaders } from "@n8io/baseline-http";
import { describe, expect, it } from "vitest";
import { apiReferenceRoutesCreate } from "./api-reference.ts";

// The CSP comes from the same middleware the Server runs first.
const appCreate = () => {
	const app = httpRouterCreate();
	app.use(httpSecureHeaders);
	app.route("/", apiReferenceRoutesCreate());
	return app;
};

const page = async () => {
	const res = await appCreate().request("/");
	return { html: await res.text(), res };
};

describe("apiReferenceRoutesCreate", () => {
	it("serves the page with the CSP nonce on both script tags and nothing from another host", async () => {
		const { html, res } = await page();
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const nonce = /nonce-([^']+)'/.exec(
			res.headers.get("content-security-policy") ?? "",
		)?.[1];
		expect(nonce).toBeDefined();
		expect([...html.matchAll(/<script [^>]*nonce="([^"]+)"/g)]).toHaveLength(2);
		expect(html.match(/nonce="([^"]+)"/g)).toEqual([
			`nonce="${nonce}"`,
			`nonce="${nonce}"`,
		]);
		expect(html).toContain('url: "/api/v1/openapi.json"');
		// The default badge asks validator.swagger.io once the page is not on localhost.
		expect(html).toContain("validatorUrl: null");
		expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//);
	});

	it("serves the viewer's script and stylesheet under a versioned URL, for a year", async () => {
		const { html } = await page();
		const script = /src="([^"]+)"/.exec(html)?.[1] ?? "";
		const style = /href="([^"]+)"/.exec(html)?.[1] ?? "";
		expect(script).toMatch(
			/^\/api\/v1\/docs\/\d+\.\d+\.\d+\/swagger-ui-bundle\.js$/,
		);
		for (const [url, type] of [
			[script, "text/javascript"],
			[style, "text/css"],
		] as const) {
			const res = await appCreate().request(url.replace("/api/v1/docs", ""));
			expect(res.status, url).toBe(200);
			expect(res.headers.get("content-type")).toContain(type);
			expect(res.headers.get("cache-control")).toBe(
				"public, max-age=31536000, immutable",
			);
			expect((await res.text()).length).toBeGreaterThan(100_000);
		}
	});

	it("does not serve another version of the files", async () => {
		const res = await appCreate().request("/1.0.0/swagger-ui-bundle.js");
		expect(res.status).toBe(404);
	});
});
