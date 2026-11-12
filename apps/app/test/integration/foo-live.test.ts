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

// Reads the stream until `text` has arrived; throws when it ends first.
const streamUntil = async (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	received: { text: string },
	text: string,
): Promise<void> => {
	const decoder = new TextDecoder();
	while (!received.text.includes(text)) {
		const { done, value } = await reader.read();
		if (done) throw new Error(`stream ended before ${text}`);
		received.text += decoder.decode(value, { stream: true });
	}
};

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
			const body = res.body?.getReader();
			if (body === undefined) throw new Error("no stream body");
			const received = { text: "" };
			// Subscribed on Redis: anything sent from now on reaches this stream.
			await streamUntil(body, received, "event: ready");

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
			await streamUntil(body, received, "foo.updated");
			expect(received.text).toContain(`{"id":"${id}","type":"foo.updated"}`);
			await body.cancel();
		} finally {
			clearTimeout(timer);
			abort.abort();
		}
	});
});
