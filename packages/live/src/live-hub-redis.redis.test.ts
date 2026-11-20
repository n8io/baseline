// The shared Redis global setup starts the Redis these tests use (vitest.config.ts).
/// <reference path="../../../test/redis/redis-global-setup.ts" />
import { createClient } from "redis";
import { describe, expect, inject, it, onTestFinished, vi } from "vitest";
import { liveHubRedisCreate } from "./index.ts";
import { liveHubContract } from "./live-hub.contract.ts";
import { liveTestAppCreate } from "./live-test-app.ts";
import { liveTestSseRead } from "./live-test-sse.ts";

type RedisClient = ReturnType<typeof createClient>;

// One shared client per instance, like the cache client a root passes in. Closed when the test ends.
const liveTestRedisClientOpen = async (): Promise<RedisClient> => {
	const redisClient: RedisClient = createClient({ url: inject("redisUrl") });
	redisClient.on("error", () => undefined);
	await redisClient.connect();
	onTestFinished(() => {
		if (redisClient.isOpen) redisClient.destroy();
	});
	return redisClient;
};

const subscriberCount = async (channel: string): Promise<number> => {
	const redisClient = await liveTestRedisClientOpen();
	const counts = await redisClient.pubSubNumSub(channel);
	return counts[channel] ?? 0;
};

const pubsubClientCount = async (): Promise<number> => {
	const redisClient = await liveTestRedisClientOpen();
	const list = await redisClient.clientList({ TYPE: "PUBSUB" });
	return list.length;
};

describe("liveHubRedisCreate", () => {
	liveHubContract(async () =>
		liveHubRedisCreate({ redisClient: await liveTestRedisClientOpen() }),
	);

	it("a note published on one hub instance reaches a stream on another", async () => {
		await using serverHub = liveHubRedisCreate({
			redisClient: await liveTestRedisClientOpen(),
		});
		await using workerHub = liveHubRedisCreate({
			redisClient: await liveTestRedisClientOpen(),
		});
		const sse = liveTestSseRead({
			response: await liveTestAppCreate(serverHub).request("/live/foo/foo_1"),
		});
		await sse.until("event: ready");

		await workerHub.send("foo", { id: "foo_1", type: "foo.updated" });

		expect(await sse.until("foo.updated")).toContain(
			'data: {"id":"foo_1","type":"foo.updated"}\n\n',
		);
	});

	it("publishes { type, id } as JSON on Redis channel live:<channel>", async () => {
		const listener = await liveTestRedisClientOpen();
		const received = Promise.withResolvers<string>();
		await listener.subscribe("live:foo", received.resolve);
		await using liveHub = liveHubRedisCreate({
			redisClient: await liveTestRedisClientOpen(),
		});

		await liveHub.send("foo", { id: "foo_1", type: "foo.updated" });

		expect(JSON.parse(await received.promise)).toEqual({
			id: "foo_1",
			type: "foo.updated",
		});
	});

	it("opens one subscriber per instance, only once a stream opens", async () => {
		const channel = `live:${crypto.randomUUID()}`;
		const name = channel.slice("live:".length);
		const liveHub = liveHubRedisCreate({
			redisClient: await liveTestRedisClientOpen(),
		});
		await liveHub.send(name, { id: "foo_1", type: "foo.updated" });
		expect(await subscriberCount(channel)).toBe(0);

		const app = liveTestAppCreate(liveHub);
		const first = liveTestSseRead({
			response: await app.request(`/live/${name}/foo_1`),
		});
		const second = liveTestSseRead({
			response: await app.request(`/live/${name}/foo_2`),
		});
		const other = liveTestSseRead({
			response: await app.request(`/live/${name}-other/foo_1`),
		});
		await first.until("event: ready");
		await second.until("event: ready");
		await other.until("event: ready");
		expect(await subscriberCount(channel)).toBe(1);
		expect(await pubsubClientCount()).toBe(1);

		await liveHub.close();
		expect(await subscriberCount(channel)).toBe(0);
	});

	it("drops a malformed message and keeps streaming", async () => {
		const publisher = await liveTestRedisClientOpen();
		await using liveHub = liveHubRedisCreate({
			redisClient: await liveTestRedisClientOpen(),
		});
		const sse = liveTestSseRead({
			response: await liveTestAppCreate(liveHub).request("/live/foo/foo_1"),
		});
		await sse.until("event: ready");

		await publisher.publish("live:foo", "not json");
		await publisher.publish("live:foo", '{"id":"foo_1"}');
		await liveHub.send("foo", { id: "foo_1", type: "foo.updated" });

		expect(await sse.until("foo.updated")).toBe(
			'event: ready\ndata: \n\ndata: {"id":"foo_1","type":"foo.updated"}\n\n',
		);
	});

	it("a send resolves when Redis is gone", async () => {
		const redisClient = await liveTestRedisClientOpen();
		const liveHub = liveHubRedisCreate({ redisClient });
		redisClient.destroy();

		expect(
			await liveHub.send("foo", { id: "foo_1", type: "foo.updated" }),
		).toBeUndefined();
	});

	it("a send Redis does not answer resolves within 1 s", async () => {
		const pauser = await liveTestRedisClientOpen();
		const liveHub = liveHubRedisCreate({
			redisClient: await liveTestRedisClientOpen(),
		});
		await pauser.clientPause(3000);
		try {
			const started = Date.now();
			expect(
				await liveHub.send("foo", { id: "foo_1", type: "foo.updated" }),
			).toBeUndefined();
			const elapsed = Date.now() - started;
			expect(elapsed).toBeGreaterThanOrEqual(950);
			expect(elapsed).toBeLessThan(1500);
		} finally {
			await pauser.clientUnpause();
		}
	});

	it("after the subscriber reconnects, an open stream gets ready again and keeps streaming", async () => {
		const admin = await liveTestRedisClientOpen();
		await using liveHub = liveHubRedisCreate({
			redisClient: await liveTestRedisClientOpen(),
		});
		const sse = liveTestSseRead({
			response: await liveTestAppCreate(liveHub).request("/live/foo/foo_1"),
		});
		await sse.until("event: ready");

		// Drops the hub's subscriber connection, as a Redis failover does.
		await admin.sendCommand(["CLIENT", "KILL", "TYPE", "pubsub"]);
		await sse.until("event: ready\ndata: \n\nevent: ready");
		await liveHub.send("foo", { id: "foo_1", type: "foo.updated" });

		expect(await sse.until("foo.updated")).toBe(
			'event: ready\ndata: \n\nevent: ready\ndata: \n\ndata: {"id":"foo_1","type":"foo.updated"}\n\n',
		);
	}, 15_000);

	it("a stream whose subscribe fails ends with a retry, and the next one retries", async () => {
		const redisClient = await liveTestRedisClientOpen();
		await using liveHub = liveHubRedisCreate({ redisClient });
		const app = liveTestAppCreate(liveHub);
		const duplicate = vi
			.spyOn(redisClient, "duplicate")
			.mockImplementationOnce(() => {
				throw new Error("Redis refused");
			});

		const failed = await liveTestSseRead({
			response: await app.request("/live/foo/foo_1"),
		}).end();
		expect(failed).toMatch(/^retry: \d+\n\n$/);

		const sse = liveTestSseRead({
			response: await app.request("/live/foo/foo_1"),
		});
		expect(await sse.until("event: ready")).toBe("event: ready\ndata: \n\n");
		expect(duplicate).toHaveBeenCalledTimes(2);
	});
});
