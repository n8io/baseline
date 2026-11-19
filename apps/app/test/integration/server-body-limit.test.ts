import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type ProductionServer,
	productionServerStart,
} from "./production-server.ts";

// The 1 MB body limit on /api, against the production build (csp.test.ts covers a Content-Length over it). A request with no Content-Length
// (a DELETE with no body, a chunked POST) is the one the limit has to read to measure.
let server: ProductionServer;

beforeAll(async () => {
	server = await productionServerStart({ databaseUrl: "memory://" });
}, 30_000);

afterAll(async () => {
	await server?.stop();
});

// A stream body goes chunked, with no Content-Length. Node's fetch needs `duplex` for one, which
// TypeScript's DOM RequestInit does not list yet.
const chunkedPost = (bytes: number): Promise<Response> => {
	const init: RequestInit & { duplex: "half" } = {
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(bytes).fill(32));
				controller.close();
			},
		}),
		duplex: "half",
		headers: { "content-type": "application/json" },
		method: "POST",
	};
	return fetch(`${server.url}/api/v1/anything`, init);
};

describe("the API body limit", { timeout: 30_000 }, () => {
	it("passes a DELETE with no body on to authentication", async () => {
		const res = await fetch(`${server.url}/api/v1/anything`, {
			method: "DELETE",
		});
		expect(res.status).toBe(401);
		await res.body?.cancel();
	});

	it("passes a chunked POST under the limit on to authentication", async () => {
		const res = await chunkedPost(1024);
		expect(res.status).toBe(401);
		await res.body?.cancel();
	});

	it("answers 413 PayloadTooLarge to a chunked POST over 1 MB", async () => {
		const res = await chunkedPost(1024 * 1024 + 1);
		expect(res.status).toBe(413);
		expect(await res.json()).toMatchObject({ code: "PayloadTooLarge" });
	});
});
