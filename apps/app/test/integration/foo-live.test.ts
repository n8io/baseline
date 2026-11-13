import { liveTestSseRead } from "@n8io/baseline-live/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import { integrationSignIn } from "./integration-sign-in.ts";
import {
	type ProductionServer,
	productionServerStart,
} from "./production-server.ts";

const servers: ProductionServer[] = [];
let drop: () => Promise<void>;

beforeAll(async () => {
	const database = await integrationDatabaseCreate();
	drop = database.drop;
	const options = {
		databaseUrl: database.databaseUrl,
	};
	const started = await Promise.allSettled([
		productionServerStart(options),
		productionServerStart(options),
	]);
	for (const result of started) {
		if (result.status === "fulfilled") servers.push(result.value);
	}
	for (const result of started) {
		if (result.status === "rejected") throw result.reason;
	}
}, 30_000);

afterAll(async () => {
	await Promise.all(servers.map((server) => server.stop()));
	await drop?.();
});

describe("live updates across server instances", { timeout: 30_000 }, () => {
	it("delivers a change made on one instance to a stream open on another", async () => {
		const [streaming, changing] = servers as [
			ProductionServer,
			ProductionServer,
		];
		const reader = await integrationSignIn(streaming.url, "user");
		const writer = await integrationSignIn(changing.url, "user");
		const created = await fetch(`${changing.url}/api/v1/foos`, {
			body: JSON.stringify({ name: "Watched" }),
			headers: {
				authorization: writer.authorization,
				"content-type": "application/json",
			},
			method: "POST",
		});
		expect(created.status).toBe(201);
		const { id } = (await created.json()) as { id: string };

		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), 10_000);
		try {
			const res = await fetch(`${streaming.url}/live/foo/${id}`, {
				headers: { accept: "text/event-stream", cookie: reader.cookie },
				signal: abort.signal,
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
			const sse = liveTestSseRead({ response: res });
			// Subscribed on Redis: anything sent from now on reaches this stream.
			await sse.until("event: ready");

			const renamed = await fetch(`${changing.url}/api/v1/foos/${id}`, {
				body: JSON.stringify({ name: "Watched and renamed" }),
				headers: {
					authorization: writer.authorization,
					"content-type": "application/json",
				},
				method: "PATCH",
			});
			expect(renamed.status).toBe(200);

			// The event arrives while the stream stays open: @preventLeaks' response scan
			// flushes each event rather than holding the body until it ends.
			expect(await sse.until("foo.updated")).toContain(
				`{"id":"${id}","type":"foo.updated"}`,
			);
			await sse.cancel();
		} finally {
			clearTimeout(timer);
			abort.abort();
		}
	});
});
