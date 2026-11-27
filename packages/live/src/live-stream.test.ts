import { getEventListeners } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type LiveHub, liveHubMemoryCreate } from "./index.ts";
import { liveHubCreate, liveHubStreams } from "./live-hub.ts";
import { liveLoggerTestRecord } from "./live-logger-test-record.ts";
import {
	liveHeartbeatMs,
	liveRetryMs,
	liveStreamCreate,
	liveStreamMaxMs,
} from "./live-stream.ts";
import { liveTestAppCreate } from "./live-test-app.ts";
import { liveTestSseRead } from "./live-test-sse.ts";

const open = async (
	app: ReturnType<typeof liveTestAppCreate>,
	path = "/live/foo/foo_1",
) => {
	const response = await app.request(path);
	const sse = liveTestSseRead({ response });
	await sse.until("event: ready");
	return { response, sse };
};

describe("liveStreamCreate", () => {
	it("answers an SSE response that sends ready once subscribed", async () => {
		await using liveHub = liveHubMemoryCreate();
		const { response, sse } = await open(liveTestAppCreate(liveHub));

		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Cache-Control")).toBe("no-cache");
		expect(await sse.until("\n\n")).toBe("event: ready\ndata: \n\n");
	});

	it("answered through a Hono context, it keeps the headers middleware set", async () => {
		await using liveHub = liveHubMemoryCreate();
		const app = new Hono()
			.use(async (c, next) => {
				c.header("X-Request-Id", "req_1");
				await next();
			})
			.route("/", liveTestAppCreate(liveHub));
		const { response } = await open(app);

		expect(response.headers.get("X-Request-Id")).toBe("req_1");
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
	});

	it("sends a comment every 20 s", () => {
		expect(liveHeartbeatMs).toBe(20_000);
	});

	it("sends a comment on each heartbeat", async () => {
		await using liveHub = liveHubMemoryCreate();
		const app = liveTestAppCreate(liveHub, { timing: { heartbeatMs: 20 } });
		const { sse } = await open(app);

		expect(await sse.until(": heartbeat\n\n")).toMatch(
			/^event: ready\ndata: \n\n: heartbeat\n\n/,
		);
	});

	it("stays open for 5 minutes at most", () => {
		expect(liveStreamMaxMs).toBe(5 * 60_000);
	});

	it.each([
		{
			expiresInMs: 60 * 60_000,
			maxMs: 100,
			when: "after its longest life",
		},
		{
			expiresInMs: 100,
			maxMs: liveStreamMaxMs,
			when: "at expiresAt when sooner",
		},
	])("closes $when with a retry", async ({ expiresInMs, maxMs }) => {
		await using liveHub = liveHubMemoryCreate();
		const app = liveTestAppCreate(liveHub, {
			expiresAt: () => Date.now() + expiresInMs,
			timing: { maxMs, retryMs: () => 5000 },
		});
		const { sse } = await open(app);
		let ended = false;
		const end = sse.end().then((text) => {
			ended = true;
			return text;
		});

		expect(ended).toBe(false);

		expect((await end).endsWith("retry: 5000\n\n")).toBe(true);
	});

	it("picks the retry between 1000 and 5000 ms", () => {
		expect(
			[0, 0.5, 0.999_999].map((random) => liveRetryMs(() => random)),
		).toEqual([1000, 3000, 5000]);
	});

	it("await using closes the hub when its block ends", async () => {
		let closed: LiveHub;
		{
			await using liveHub = liveHubMemoryCreate();
			closed = liveHub;
		}

		const response = await liveTestAppCreate(closed).request("/live/foo/foo_1");

		expect(await liveTestSseRead({ response }).end()).toMatch(
			/^retry: \d+\n\n$/,
		);
	});

	it("a client that goes away stops listening and no longer holds close()", async () => {
		const liveHub = liveHubMemoryCreate();
		const streams = liveHubStreams(liveHub, "liveStreamCreate");
		const listen = streams.listen;
		let unlistened = 0;
		streams.listen = async (...args) => {
			const unlisten = await listen(...args);
			return () => {
				unlistened += 1;
				unlisten();
			};
		};
		const { sse } = await open(liveTestAppCreate(liveHub));

		await sse.cancel();

		await expect.poll(() => unlistened).toBe(1);
		await expect(liveHub.close()).resolves.toBeUndefined();
	});

	it("an aborted request ends the stream and no longer holds close()", async () => {
		const liveHub = liveHubMemoryCreate();
		const request = new AbortController();
		const sse = liveTestSseRead({
			response: liveStreamCreate({
				channel: "foo",
				expiresAt: Number.POSITIVE_INFINITY,
				id: "foo_1",
				liveHub,
				signal: request.signal,
			}),
		});
		await sse.until("event: ready");

		request.abort();

		expect(await sse.end()).toBe("event: ready\ndata: \n\n");
		await expect(liveHub.close()).resolves.toBeUndefined();
	});

	it("a request aborted before the stream starts never subscribes", async () => {
		await using liveHub = liveHubMemoryCreate();
		const streams = liveHubStreams(liveHub, "liveStreamCreate");
		const listen = streams.listen;
		let listens = 0;
		streams.listen = (...args) => {
			listens += 1;
			return listen(...args);
		};
		const sse = liveTestSseRead({
			response: liveStreamCreate({
				channel: "foo",
				expiresAt: Number.POSITIVE_INFINITY,
				id: "foo_1",
				liveHub,
				signal: AbortSignal.abort(),
			}),
		});

		expect(await sse.end()).toBe("");
		expect(listens).toBe(0);
	});

	it("drops a page that stops reading once 64 KiB wait for it", async () => {
		await using liveHub = liveHubMemoryCreate();
		const sse = liveTestSseRead({
			response: liveStreamCreate({
				channel: "foo",
				expiresAt: Number.POSITIVE_INFINITY,
				id: "foo_1",
				liveHub,
			}),
		});
		await sse.until("event: ready");

		for (let sent = 0; sent < 2000; sent += 1) {
			await liveHub.send("foo", { id: "foo_1", type: "foo.updated" });
		}

		expect(await sse.end()).toMatch(/retry: \d+\n\n$/);
	});

	it("close() does not wait on a subscribe that never finishes", async () => {
		const liveHub = liveHubMemoryCreate();
		let lates = 0;
		const late = () => {
			lates += 1;
		};
		const listening = Promise.withResolvers<() => void>();
		liveHubStreams(liveHub, "liveStreamCreate").listen = () =>
			listening.promise;
		const sse = liveTestSseRead({
			response: await liveTestAppCreate(liveHub).request("/live/foo/foo_1"),
		});

		await liveHub.close();
		expect(await sse.end()).toMatch(/^retry: \d+\n\n$/);

		listening.resolve(late);
		await expect.poll(() => lates).toBe(1);
	});

	it("refuses an expiresAt that is not a number", async () => {
		await using liveHub = liveHubMemoryCreate();
		const call = (expiresAt: number) => () =>
			liveStreamCreate({ channel: "foo", expiresAt, id: "foo_1", liveHub });

		expect(call(Number.NaN)).toThrow(TypeError);
		expect(call(Number.NaN)).toThrow(
			"liveStreamCreate: expiresAt must be a number",
		);
		expect(call("soon" as unknown as number)).toThrow(
			"liveStreamCreate: expiresAt must be a number",
		);
	});

	it("refuses a hub it did not make", () => {
		expect(() =>
			liveStreamCreate({
				channel: "foo",
				expiresAt: Number.POSITIVE_INFINITY,
				id: "foo_1",
				liveHub: {
					close: async () => {},
					[Symbol.asyncDispose]: async () => {},
					send: async () => {},
				},
			}),
		).toThrow(
			"liveStreamCreate: liveHub must come from liveHubRedisCreate or liveHubMemoryCreate",
		);
	});

	const timersOpen = (): number =>
		process.getActiveResourcesInfo().filter((name) => name === "Timeout")
			.length;

	it("logs a subscribe that failed, and ends with a retry", async () => {
		using error = liveLoggerTestRecord("error");
		const liveHub = liveHubMemoryCreate();
		liveHubStreams(liveHub, "liveStreamCreate").listen = async () => {
			throw new Error("subscribe failed");
		};
		const sse = liveTestSseRead({
			response: await liveTestAppCreate(liveHub).request("/live/foo/foo_1"),
		});

		expect(await sse.end()).toMatch(/^retry: \d+\n\n$/);
		expect(error.calls).toEqual([
			[
				{ err: new Error("subscribe failed") },
				"Live stream failed to subscribe",
			],
		]);
		await liveHub.close();
	});

	it("leaves no timer, abort listener or tracked end behind once it ends", async () => {
		let lost = (): void => {};
		const liveHub = liveHubCreate({
			close: async () => {},
			publish: async () => {},
			resyncListen: (resync) => {
				lost = resync;
			},
			subscribe: async () => {},
		});
		const streams = liveHubStreams(liveHub, "liveStreamCreate");
		const track = streams.track;
		let untracked = 0;
		streams.track = (end) => {
			const untrack = track(end);
			return () => {
				untracked += 1;
				untrack();
			};
		};
		const baseline = timersOpen();
		const request = new AbortController();
		const sse = liveTestSseRead({
			response: liveStreamCreate({
				channel: "foo",
				expiresAt: Number.POSITIVE_INFINITY,
				id: "foo_1",
				liveHub,
				signal: request.signal,
			}),
		});
		await sse.until("event: ready");
		// A resync pending, a heartbeat running and the lifetime ticking: three timers.
		lost();
		expect(timersOpen()).toBe(baseline + 3);
		expect(getEventListeners(request.signal, "abort")).toHaveLength(1);

		request.abort();
		// Taken off at the abort itself, not only once the stream has wound down.
		expect(getEventListeners(request.signal, "abort")).toHaveLength(0);
		await sse.end();

		expect(timersOpen()).toBe(baseline);
		expect(untracked).toBe(1);
		await liveHub.close();
	});

	it("takes the abort listener off when the stream ends on its own", async () => {
		const liveHub = liveHubMemoryCreate();
		const request = new AbortController();
		const sse = liveTestSseRead({
			response: liveStreamCreate({
				channel: "foo",
				expiresAt: Number.POSITIVE_INFINITY,
				id: "foo_1",
				liveHub,
				signal: request.signal,
			}),
		});
		await sse.until("event: ready");

		await liveHub.close();
		await sse.end();

		expect(getEventListeners(request.signal, "abort")).toHaveLength(0);
	});

	it("drops a page whose unread updates fill 64 KiB exactly, and not one byte sooner", async () => {
		await using liveHub = liveHubMemoryCreate();
		const streams = liveHubStreams(liveHub, "liveStreamCreate");
		const track = streams.track;
		let untracked = 0;
		streams.track = (end) => {
			const untrack = track(end);
			return () => {
				untracked += 1;
				untrack();
			};
		};
		const response = liveStreamCreate({
			channel: "foo",
			expiresAt: Number.POSITIVE_INFINITY,
			id: "foo_1",
			liveHub,
		});
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		const encoder = new TextEncoder();
		// The size of an update is set by the length of its type.
		const update = (typeLength: number) => ({
			id: "foo_1",
			type: "t".repeat(typeLength),
		});
		const sizeOf = (typeLength: number): number =>
			encoder.encode(`data: ${JSON.stringify(update(typeLength))}\n\n`).length;
		const readySize = encoder.encode("event: ready\ndata: \n\n").length;
		const smallest = sizeOf(1);
		const big = 1000;
		const bigId = big - (smallest - 1);
		// Everything but one smallest update, so one more fills the buffer to 65536 bytes.
		const before = 64 * 1024 - smallest - readySize;
		let chunks = Math.floor(before / big);
		let rest = before - chunks * big;
		if (rest > 0 && rest < smallest) {
			chunks -= 1;
			rest += big;
		}
		// Nothing reads yet, so every byte stays queued; give the subscribe its turns.
		await sleep(20);

		for (let sent = 0; sent < chunks; sent += 1) {
			await liveHub.send("foo", update(bigId));
		}
		if (rest > 0) await liveHub.send("foo", update(rest - (smallest - 1)));
		// The stream is still running: nothing has taken it off the hub's list yet.
		await sleep(50);
		expect(untracked).toBe(0);

		await liveHub.send("foo", update(1));

		await expect.poll(() => untracked).toBe(1);
		let text = "";
		let bytes = 0;
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			bytes += next.value.length;
			text += new TextDecoder().decode(next.value);
		}
		// Ready and every update fit exactly 64 KiB, then the retry.
		const retry = /retry: \d+\n\n$/.exec(text)?.[0] ?? "";
		expect(retry).not.toBe("");
		expect(bytes - retry.length).toBe(64 * 1024);
	});
});
