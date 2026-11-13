import { afterEach, describe, expect, test, vi } from "vitest";
import { liveHubMemoryCreate } from "./index.ts";
import { liveHubStreams } from "./live-hub.ts";
import {
	liveHeartbeatMs,
	liveStreamCreate,
	liveStreamMaxMs,
} from "./live-stream.ts";
import { liveAppCreate, liveTestSseRead } from "./live-test-sse.ts";

const open = async (
	app: ReturnType<typeof liveAppCreate>,
	path = "/live/foo/foo_1",
) => {
	const response = await app.request(path);
	const sse = liveTestSseRead(response);
	await sse.until("event: ready");
	return { response, sse };
};

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("liveStreamCreate", () => {
	test("answers an SSE response that sends ready once subscribed", async () => {
		const liveHub = liveHubMemoryCreate();
		const { response, sse } = await open(liveAppCreate(liveHub));

		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Cache-Control")).toBe("no-cache");
		expect(await sse.until("\n\n")).toBe("event: ready\ndata: \n\n");
		await liveHub.close();
	});

	test("sends { type, id } for its own (channel, id) only", async () => {
		const liveHub = liveHubMemoryCreate();
		const app = liveAppCreate(liveHub);
		const { sse } = await open(app);

		await liveHub.send("foo", { id: "foo_2", type: "foo.updated" });
		await liveHub.send("bar", { id: "foo_1", type: "bar.updated" });
		await liveHub.send("foo", { id: "foo_1", type: "foo.updated" });
		const text = await sse.until("foo.updated");

		expect(text).toBe(
			'event: ready\ndata: \n\ndata: {"id":"foo_1","type":"foo.updated"}\n\n',
		);
		await liveHub.close();
	});

	test("sends only type and id, whatever else the sender passes", async () => {
		const liveHub = liveHubMemoryCreate();
		const { sse } = await open(liveAppCreate(liveHub));

		const update = { id: "foo_1", name: "secret", type: "foo.updated" };
		await liveHub.send("foo", update);

		expect(await sse.until("foo.updated")).not.toContain("secret");
		await liveHub.close();
	});

	test("sends a comment every 20 s", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
		const liveHub = liveHubMemoryCreate();
		const { sse } = await open(liveAppCreate(liveHub));

		await vi.advanceTimersByTimeAsync(liveHeartbeatMs - 1);
		await vi.advanceTimersByTimeAsync(1);

		expect(await sse.until(": heartbeat\n\n")).toBe(
			"event: ready\ndata: \n\n: heartbeat\n\n",
		);
		await liveHub.close();
	});

	test.each([
		["after 5 minutes", 60 * 60_000, liveStreamMaxMs],
		["at expiresAt when sooner", 90_000, 90_000],
	])("closes %s with a retry of 1–5 s", async (_, expiresInMs, closesAtMs) => {
		vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
		vi.spyOn(Math, "random").mockReturnValue(0.999_999);
		const liveHub = liveHubMemoryCreate();
		const startedAt = Date.now();
		const app = liveAppCreate(liveHub, () => startedAt + expiresInMs);
		const { sse } = await open(app);
		let ended = false;
		const end = sse.end().then((text) => {
			ended = true;
			return text;
		});

		await vi.advanceTimersByTimeAsync(closesAtMs - 1);
		expect(ended).toBe(false);
		await vi.advanceTimersByTimeAsync(1);

		expect((await end).endsWith("retry: 5000\n\n")).toBe(true);
		await liveHub.close();
	});

	test("picks the retry between 1000 and 5000 ms", async () => {
		const liveHub = liveHubMemoryCreate();
		const app = liveAppCreate(liveHub, () => Date.now() - 1);
		const retries = [];
		for (const random of [0, 0.5, 0.999_999]) {
			vi.spyOn(Math, "random").mockReturnValue(random);
			retries.push(
				/retry: (\d+)/.exec(
					await liveTestSseRead(await app.request("/live/foo/foo_1")).end(),
				)?.[1],
			);
		}

		expect(retries).toEqual(["1000", "3000", "5000"]);
		await liveHub.close();
	});

	test("liveHub.close() sends every stream a retry, closes it, then resolves", async () => {
		const liveHub = liveHubMemoryCreate();
		const app = liveAppCreate(liveHub);
		const first = await open(app, "/live/foo/foo_1");
		const second = await open(app, "/live/foo/foo_2");

		await liveHub.close();

		expect(await first.sse.end()).toMatch(/retry: \d+\n\n$/);
		expect(await second.sse.end()).toMatch(/retry: \d+\n\n$/);
	});

	test("a stream opened after close ends at once with a retry", async () => {
		const liveHub = liveHubMemoryCreate();
		await liveHub.close();

		const response = await liveAppCreate(liveHub).request("/live/foo/foo_1");

		expect(await liveTestSseRead(response).end()).toMatch(/^retry: \d+\n\n$/);
	});

	test("a client that goes away stops listening and no longer holds close()", async () => {
		const liveHub = liveHubMemoryCreate();
		const streams = liveHubStreams(liveHub);
		const listen = streams.listen;
		let unlistened = 0;
		vi.spyOn(streams, "listen").mockImplementation(async (...args) => {
			const unlisten = await listen(...args);
			return () => {
				unlistened += 1;
				unlisten();
			};
		});
		const { sse } = await open(liveAppCreate(liveHub));

		await sse.cancel();

		await vi.waitFor(() => {
			expect(unlistened).toBe(1);
		});
		await expect(liveHub.close()).resolves.toBeUndefined();
	});

	test("an aborted request ends the stream and no longer holds close()", async () => {
		const liveHub = liveHubMemoryCreate();
		const request = new AbortController();
		const sse = liveTestSseRead(
			liveStreamCreate({
				channel: "foo",
				expiresAt: Number.POSITIVE_INFINITY,
				id: "foo_1",
				liveHub,
				signal: request.signal,
			}),
		);
		await sse.until("event: ready");

		request.abort();

		expect(await sse.end()).toBe("event: ready\ndata: \n\n");
		await expect(liveHub.close()).resolves.toBeUndefined();
	});

	test("drops a page that stops reading once 64 KiB wait for it", async () => {
		const liveHub = liveHubMemoryCreate();
		const sse = liveTestSseRead(
			liveStreamCreate({
				channel: "foo",
				expiresAt: Number.POSITIVE_INFINITY,
				id: "foo_1",
				liveHub,
			}),
		);
		await sse.until("event: ready");

		for (let sent = 0; sent < 2000; sent += 1) {
			await liveHub.send("foo", { id: "foo_1", type: "foo.updated" });
		}

		expect(await sse.end()).toMatch(/retry: \d+\n\n$/);
		await liveHub.close();
	});

	test("close() does not wait on a subscribe that never finishes", async () => {
		const liveHub = liveHubMemoryCreate();
		const late = vi.fn();
		const listening = Promise.withResolvers<() => void>();
		vi.spyOn(liveHubStreams(liveHub), "listen").mockReturnValue(
			listening.promise,
		);
		const sse = liveTestSseRead(
			await liveAppCreate(liveHub).request("/live/foo/foo_1"),
		);

		await liveHub.close();
		expect(await sse.end()).toMatch(/^retry: \d+\n\n$/);

		listening.resolve(late);
		await vi.waitFor(() => {
			expect(late).toHaveBeenCalledOnce();
		});
	});

	test("refuses a hub it did not make", () => {
		expect(() =>
			liveHubStreams({ close: async () => {}, send: async () => {} }),
		).toThrow(
			"liveHub must come from liveHubRedisCreate or liveHubMemoryCreate",
		);
	});
});
