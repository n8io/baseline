import { setTimeout as sleep } from "node:timers/promises";
import { type Meter, metrics } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import {
	type LiveTransport,
	type LiveUpdate,
	liveHubCreate,
	liveHubStreams,
} from "./live-hub.ts";
import { liveTestAppCreate } from "./live-test-app.ts";
import { liveTestSseRead } from "./live-test-sse.ts";

// What the Package asked the meter provider for, and each increment, kept across tests: it asks
// once, on the first failed send.
const asked: { counter: unknown[][]; meter: string[] } = {
	counter: [],
	meter: [],
};
const increments: { attributes: unknown; value: number }[] = [];
metrics.setGlobalMeterProvider({
	getMeter: (name: string) => {
		asked.meter.push(name);
		return {
			createCounter: (...args: unknown[]) => {
				asked.counter.push(args);
				return {
					add: (value: number, attributes: unknown) => {
						increments.push({ attributes, value });
					},
				};
			},
		} as unknown as Meter;
	},
});

const transportDown: LiveTransport = {
	close: async () => {},
	publish: async () => {
		throw new Error("Transport is down");
	},
	subscribe: async () => {},
};

// A clock the test moves by hand and a logger that records its warnings.
const depsCreate = () => {
	const clock = { at: 0 };
	const warnings: unknown[][] = [];
	return {
		advance: (ms: number) => {
			clock.at += ms;
		},
		logger: { warn: (...args: unknown[]) => void warnings.push(args) },
		now: () => clock.at,
		warnings,
	};
};

describe("liveHubCreate", () => {
	it("send resolves when the transport fails, and warns", async () => {
		const { logger, warnings } = depsCreate();
		await using liveHub = liveHubCreate(transportDown, { logger });

		expect(
			await liveHub.send("foo", { id: "foo_1", type: "foo.updated" }),
		).toBeUndefined();
		expect(warnings).toEqual([
			[
				{ channel: "foo", err: new Error("Transport is down"), unlogged: 0 },
				"Live update not sent",
			],
		]);
		expect(increments).toEqual([
			{ attributes: { "baseline.live.channel": "foo" }, value: 1 },
		]);
		// It asks once, on the first failed send, so this is the test that sees the request.
		expect(asked).toEqual({
			counter: [
				[
					"baseline.live.sends_failed",
					{
						description: "Live updates the transport could not send",
						unit: "{update}",
					},
				],
			],
			meter: ["@n8io/baseline-live"],
		});
	});

	it("warns once per 30 s, with how many failures went unlogged", async () => {
		const { advance, logger, now, warnings } = depsCreate();
		await using liveHub = liveHubCreate(transportDown, { logger, now });
		const send = () =>
			liveHub.send("foo", { id: "foo_1", type: "foo.updated" });

		for (let call = 0; call < 5; call += 1) await send();
		expect(warnings).toHaveLength(1);

		advance(30_000);
		await send();
		expect(warnings).toHaveLength(2);
		expect(warnings.at(-1)).toEqual([
			expect.objectContaining({ unlogged: 4 }),
			"Live update not sent",
		]);
	});

	it("when the transport may have lost updates, each open stream gets ready again once", async () => {
		let lost = (): void => {};
		await using liveHub = liveHubCreate({
			close: async () => {},
			publish: async () => {},
			resyncListen: (resync) => {
				lost = resync;
			},
			subscribe: async () => {},
		});
		const app = liveTestAppCreate(liveHub, { timing: { retryMs: () => 10 } });
		const first = liveTestSseRead({
			response: await app.request("/live/foo/foo_1"),
		});
		const second = liveTestSseRead({
			response: await app.request("/live/bar/bar_1"),
		});
		const gone = liveTestSseRead({
			response: await app.request("/live/foo/foo_2"),
		});
		await first.until("event: ready");
		await second.until("event: ready");
		await gone.until("event: ready");
		await gone.cancel();

		lost();
		// A second loss before the first is told is still one ready.
		lost();
		const ready = "event: ready\ndata: \n\nevent: ready\ndata: \n\n";
		await first.until(ready);
		await second.until(ready);
		// Long enough for a duplicate ready to arrive, were there one.
		await sleep(40);
		await liveHub.close();

		const twice =
			/^event: ready\ndata: \n\nevent: ready\ndata: \n\nretry: \d+\n\n$/;
		expect(await first.end()).toMatch(twice);
		expect(await second.end()).toMatch(twice);
	});

	// A transport that keeps what the hub asks of it, and delivers what a test hands it.
	const transportCreate = (
		overrides: Partial<LiveTransport> = {},
	): {
		closes: () => number;
		deliver: (channel: string, message: string) => void;
		lost: () => void;
		subscribes: string[];
		transport: LiveTransport;
	} => {
		const delivers = new Map<string, (message: string) => void>();
		const subscribes: string[] = [];
		let closes = 0;
		let lost = (): void => {};
		return {
			closes: () => closes,
			deliver: (channel, message) => delivers.get(channel)?.(message),
			lost: () => lost(),
			subscribes,
			transport: {
				close: async () => {
					closes += 1;
				},
				publish: async () => {},
				resyncListen: (resync) => {
					lost = resync;
				},
				subscribe: async (channel, deliver) => {
					subscribes.push(channel);
					delivers.set(channel, deliver);
				},
				...overrides,
			},
		};
	};
	const listenCreate = async (
		liveHub: ReturnType<typeof liveHubCreate>,
		channel: string,
		id: string,
	) => {
		const updates: LiveUpdate[] = [];
		let resyncs = 0;
		const unlisten = await liveHubStreams(liveHub, "test").listen({
			channel,
			id,
			listener: (update) => updates.push(update),
			resync: () => {
				resyncs += 1;
			},
		});
		return { resyncs: () => resyncs, unlisten, updates };
	};

	it("delivers an update to the listeners of its (channel, id) only", async () => {
		const { deliver, transport } = transportCreate();
		await using liveHub = liveHubCreate(transport);
		const one = await listenCreate(liveHub, "foo", "foo_1");
		const two = await listenCreate(liveHub, "foo", "foo_1");
		const other = await listenCreate(liveHub, "foo", "foo_2");

		deliver("foo", '{"id":"foo_1","type":"foo.updated"}');

		const update = { id: "foo_1", type: "foo.updated" };
		expect(one.updates).toEqual([update]);
		expect(two.updates).toEqual([update]);
		expect(other.updates).toEqual([]);
	});

	it("drops a message that is not a { type, id } of strings, and warns with its channel", async () => {
		const { deliver, transport } = transportCreate();
		const { logger, warnings } = depsCreate();
		await using liveHub = liveHubCreate(transport, { logger });
		const listening = await listenCreate(liveHub, "foo", "foo_1");
		const bad = [
			"not json",
			"null",
			"5",
			'"text"',
			"[]",
			'{"type":"foo.updated"}',
			'{"id":"foo_1"}',
			'{"id":"foo_1","type":1}',
			'{"id":1,"type":"foo.updated"}',
		];

		for (const message of bad) deliver("foo", message);

		expect(listening.updates).toEqual([]);
		expect(warnings).toEqual(
			bad.map(() => [{ channel: "foo" }, "Dropped a malformed Live update"]),
		);
	});

	it("takes only type and id from a message, and ignores one nobody listens for", async () => {
		const { deliver, transport } = transportCreate();
		await using liveHub = liveHubCreate(transport);
		const listening = await listenCreate(liveHub, "foo", "foo_1");

		expect(() =>
			deliver("foo", '{"id":"foo_9","type":"foo.updated"}'),
		).not.toThrow();
		deliver("foo", '{"id":"foo_1","type":"foo.updated","name":"secret"}');

		expect(listening.updates).toEqual([{ id: "foo_1", type: "foo.updated" }]);
	});

	it("subscribes to a channel once, however many streams listen", async () => {
		const { subscribes, transport } = transportCreate();
		await using liveHub = liveHubCreate(transport);

		await listenCreate(liveHub, "foo", "foo_1");
		await listenCreate(liveHub, "foo", "foo_2");
		await listenCreate(liveHub, "bar", "bar_1");

		expect(subscribes).toEqual(["foo", "bar"]);
	});

	it("retries a subscribe that failed on the next listen", async () => {
		let attempts = 0;
		const { subscribes, transport } = transportCreate({
			subscribe: async (channel) => {
				attempts += 1;
				if (attempts === 1) throw new Error("subscribe failed");
				subscribes.push(channel);
			},
		});
		await using liveHub = liveHubCreate(transport);

		await expect(listenCreate(liveHub, "foo", "foo_1")).rejects.toThrow(
			"subscribe failed",
		);
		await listenCreate(liveHub, "foo", "foo_1");

		expect(attempts).toBe(2);
		expect(subscribes).toEqual(["foo"]);
	});

	it("stops delivering to a listener that left, and keeps the others on its key", async () => {
		const { deliver, transport } = transportCreate();
		await using liveHub = liveHubCreate(transport);
		const leaving = await listenCreate(liveHub, "foo", "foo_1");
		const staying = await listenCreate(liveHub, "foo", "foo_1");

		leaving.unlisten();
		deliver("foo", '{"id":"foo_1","type":"foo.updated"}');

		expect(leaving.updates).toEqual([]);
		expect(staying.updates).toHaveLength(1);
	});

	it("leaves a later listener of the same key alone when an earlier one leaves again", async () => {
		const { deliver, transport } = transportCreate();
		await using liveHub = liveHubCreate(transport);
		const first = await listenCreate(liveHub, "foo", "foo_1");
		first.unlisten();
		const second = await listenCreate(liveHub, "foo", "foo_1");

		first.unlisten();
		deliver("foo", '{"id":"foo_1","type":"foo.updated"}');

		expect(second.updates).toHaveLength(1);
	});

	it("tells every listening stream to resync when the transport loses updates, until it leaves", async () => {
		const { lost, transport } = transportCreate();
		await using liveHub = liveHubCreate(transport);
		const staying = await listenCreate(liveHub, "foo", "foo_1");
		const leaving = await listenCreate(liveHub, "foo", "foo_2");

		lost();
		leaving.unlisten();
		lost();

		expect(staying.resyncs()).toBe(2);
		expect(leaving.resyncs()).toBe(1);
	});

	it("close() ends every tracked stream once, closes the transport once, and skips one that left", async () => {
		const { closes, transport } = transportCreate();
		const liveHub = liveHubCreate(transport);
		const streams = liveHubStreams(liveHub, "test");
		const ended: string[] = [];
		streams.track(async () => {
			ended.push("kept");
		});
		const untrack = streams.track(async () => {
			ended.push("gone");
		});
		untrack();
		expect(streams.isClosed()).toBe(false);

		await liveHub.close();
		await liveHub.close();

		expect(streams.isClosed()).toBe(true);
		expect(ended).toEqual(["kept"]);
		expect(closes()).toBe(1);
	});
});
