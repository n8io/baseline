import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { httpCsrf, httpErrorHandle } from "./index.ts";

const appCreate = () => {
	const app = new Hono();
	app.onError(httpErrorHandle);
	app.use(httpCsrf);
	app.post("/action", (c) => c.text("done"));
	return app;
};

const formPost = (headers: Record<string, string>) =>
	appCreate().request("http://app.example/action", {
		body: new URLSearchParams({ name: "x" }),
		headers,
		method: "POST",
	});

describe("httpCsrf", () => {
	it("answers a cross-site form post with a 403 problem", async () => {
		const res = await formPost({ origin: "https://evil.example" });

		expect(res.status).toBe(403);
		expect(res.headers.get("content-type")).toBe("application/problem+json");
		expect(await res.json()).toEqual({
			code: "Forbidden",
			status: 403,
			title: "Forbidden",
		});
	});

	it("refuses a form post with neither Origin nor Sec-Fetch-Site", async () => {
		expect((await formPost({})).status).toBe(403);
	});

	it("refuses a same-site sibling", async () => {
		const res = await formPost({
			origin: "https://other.app.example",
			"sec-fetch-site": "same-site",
		});
		expect(res.status).toBe(403);
	});

	it("passes a same-origin form post by Origin or by Sec-Fetch-Site", async () => {
		expect((await formPost({ origin: "http://app.example" })).status).toBe(200);
		expect((await formPost({ "sec-fetch-site": "same-origin" })).status).toBe(
			200,
		);
	});

	it("takes the https Origin behind a TLS proxy that sets x-forwarded-proto", async () => {
		const proxied = { origin: "https://app.example" };
		expect((await formPost(proxied)).status).toBe(403);
		expect(
			(await formPost({ ...proxied, "x-forwarded-proto": "https" })).status,
		).toBe(200);
	});

	it("leaves JSON posts and safe methods alone", async () => {
		const app = appCreate();
		app.get("/page", (c) => c.text("page"));
		const json = await app.request("http://app.example/action", {
			body: "{}",
			headers: {
				"content-type": "application/json",
				origin: "https://evil.example",
			},
			method: "POST",
		});
		const get = await app.request("http://app.example/page", {
			headers: { origin: "https://evil.example" },
		});

		expect(json.status).toBe(200);
		expect(get.status).toBe(200);
	});
});
