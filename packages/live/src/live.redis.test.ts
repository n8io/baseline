// The shared Redis global setup starts the Redis these tests use (vitest.config.ts).
/// <reference path="../../../test/redis/redis-global-setup.ts" />
import { createClient } from "redis";
import { afterEach, describe, expect, inject, test, vi } from "vitest";
import { liveHubRedisCreate } from "./index.ts";
import { liveHubContract } from "./live-hub.contract.ts";
import { liveAppCreate } from "./live-test-app.ts";
import { liveTestSseRead } from "./live-test-sse.ts";

type RedisClient = ReturnType<typeof createClient>;

const clients: RedisClient[] = [];

// One shared client per instance, like the cache client a root passes in.
const redisClientCreate = async (): Promise<RedisClient> => {
	const redisClient: RedisClient = createClient({ url: inject("redisUrl") });
	redisClient.on("error", () => undefined);
	await redisClient.connect();
	clients.push(redisClient);
	return redisClient;
};

const subscriberCount = async (channel: string): Promise<number> => {
	const redisClient = await redisClientCreate();
	const counts = await redisClient.pubSubNumSub(channel);
	return counts[channel] ?? 0;
};

const pubsubClientCount = async (): Promise<number> => {
	const redisClient = await redisClientCreate();
	const list = await redisClient.clientList({ TYPE: "PUBSUB" });
	return list.length;
};

afterEach(async () => {
	for (const redisClient of clients.splice(0)) {
		if (redisClient.isOpen) redisClient.destroy();
	}
});

describe("liveHubRedisCreate", () => {
	liveHubContract(async () =>
		liveHubRedisCreate({ redisClient: await redisClientCreate() }),
	);

	test("a note published on one hub instance reaches a stream on another", async () => {
		const serverHub = liveHubRedisCreate({
			redisClient: await redisClientCreate(),
		});
		const workerHub = liveHubRedisCreate({
			redisClient: await redisClientCreate(),
		});
		const sse = liveTestSseRead({
			response: await liveAppCreate(serverHub).request("/live/foo/foo_1"),
		});
		await sse.until("event: ready");

		await workerHub.send("foo", { id: "foo_1", type: "foo.updated" });

		expect(await sse.until("foo.updated")).toContain(
			'data: {"id":"foo_1","type":"foo.updated"}\n\n',
		);
		await serverHub.close();
		await workerHub.close();
	});

	test("publishes { type, id } as JSON on Redis channel live:<channel>", async () => {
		const listener = await redisClientCreate();
		const received = Promise.withResolvers<string>();
		await listener.subscribe("live:foo", received.resolve);
		const liveHub = liveHubRedisCreate({
			redisClient: await redisClientCreate(),
		});

		await liveHub.send("foo", { id: "foo_1", type: "foo.updated" });

		expect(JSON.parse(await received.promise)).toEqual({
			id: "foo_1",
			type: "foo.updated",
		});
		await liveHub.close();
	});

	test("opens one subscriber per instance, only once a stream opens", async () => {
		const channel = `live:${crypto.randomUUID()}`;
		const name = channel.slice("live:".length);
		const liveHub = liveHubRedisCreate({
			redisClient: await redisClientCreate(),
		});
		await liveHub.send(name, { id: "foo_1", type: "foo.updated" });
		expect(await subscriberCount(channel)).toBe(0);

		const app = liveAppCreate(liveHub);
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

	test("drops a malformed message and keeps streaming", async () => {
		const publisher = await redisClientCreate();
		const liveHub = liveHubRedisCreate({
			redisClient: await redisClientCreate(),
		});
		const sse = liveTestSseRead({
			response: await liveAppCreate(liveHub).request("/live/foo/foo_1"),
		});
		await sse.until("event: ready");

		await publisher.publish("live:foo", "not json");
		await publisher.publish("live:foo", '{"id":"foo_1"}');
		await liveHub.send("foo", { id: "foo_1", type: "foo.updated" });

		expect(await sse.until("foo.updated")).toBe(
			'event: ready\ndata: \n\ndata: {"id":"foo_1","type":"foo.updated"}\n\n',
		);
		await liveHub.close();
	});

	test("a failed send throws", async () => {
		const redisClient = await redisClientCreate();
		const liveHub = liveHubRedisCreate({ redisClient });
		redisClient.destroy();

		await expect(
			liveHub.send("foo", { id: "foo_1", type: "foo.updated" }),
		).rejects.toThrow();
	});

	test("a send Redis does not answer fails within 1 s", async () => {
		const pauser = await redisClientCreate();
		const liveHub = liveHubRedisCreate({
			redisClient: await redisClientCreate(),
		});
		await pauser.clientPause(3000);
		const started = Date.now();

		await expect(
			liveHub.send("foo", { id: "foo_1", type: "foo.updated" }),
		).rejects.toThrow(
			expect.objectContaining({
				message: "Redis did not answer within 1000 ms",
				name: "TimeoutError",
			}),
		);
		expect(Date.now() - started).toBeLessThan(1500);
		await pauser.clientUnpause();
	});

	test("a stream whose subscribe fails ends with a retry, and the next one retries", async () => {
		const redisClient = await redisClientCreate();
		const liveHub = liveHubRedisCreate({ redisClient });
		const app = liveAppCreate(liveHub);
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
		await liveHub.close();
	});
});
