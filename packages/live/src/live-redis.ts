import { cacheTimeLimit, type RedisClient } from "@n8io/baseline-cache";
import { logger } from "@n8io/baseline-logger";
import { type LiveHub, liveHubCreate } from "./live-hub.ts";

const liveConnectTimeoutMs = 3000;
const liveCommandTimeoutMs = 1000;

// Publishes to Redis channel `live:<channel>`, so every instance's streams get
// the update. The subscriber connection, a duplicate of `redisClient`, opens
// with the first stream; a worker that only sends never opens it.
export const liveHubRedisCreate = (redisClient: RedisClient): LiveHub => {
	let subscriber: Promise<RedisClient> | undefined;

	const subscriberConnect = async (): Promise<RedisClient> => {
		const connection: RedisClient = redisClient.duplicate();
		// node-redis exits the process on an unlistened error event.
		connection.on("error", (err: unknown) => {
			logger.error({ err }, "Redis live subscriber error");
		});
		try {
			await cacheTimeLimit(
				connection.connect(),
				liveConnectTimeoutMs,
				`Redis not reachable within ${liveConnectTimeoutMs} ms`,
			);
		} catch (err) {
			connection.destroy();
			throw err;
		}
		return connection;
	};

	const subscriberGet = (): Promise<RedisClient> => {
		if (subscriber === undefined) {
			const connecting = subscriberConnect();
			subscriber = connecting;
			// The next stream tries again.
			connecting.catch(() => {
				if (subscriber === connecting) subscriber = undefined;
			});
		}
		return subscriber;
	};

	return liveHubCreate({
		close: async () => {
			const connection = await subscriber?.catch(() => undefined);
			await connection?.close();
		},
		publish: async (channel, message) => {
			await cacheTimeLimit(
				redisClient.publish(`live:${channel}`, message),
				liveCommandTimeoutMs,
				`Redis did not answer within ${liveCommandTimeoutMs} ms`,
			);
		},
		subscribe: async (channel, deliver) => {
			const connection = await subscriberGet();
			try {
				await cacheTimeLimit(
					connection.subscribe(`live:${channel}`, deliver),
					liveCommandTimeoutMs,
					`Redis did not answer within ${liveCommandTimeoutMs} ms`,
				);
			} catch (err) {
				// A late SUBSCRIBE would deliver twice once the next stream retries.
				connection
					.unsubscribe(`live:${channel}`, deliver)
					.catch(() => undefined);
				throw err;
			}
		},
	});
};
