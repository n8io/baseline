// The Redis connection the cache and live updates share. docs/agents/pieces.md deletes this file
// with the redis piece, once neither of them is left.
import { logger } from "@n8io/baseline-logger";
import { createClient } from "redis";

export type RedisClient = ReturnType<typeof createClient>;

// Resolves once connected, so an unreachable Redis stops startup within the connect timeout.
// After that a dropped connection reconnects every min(retries × 100 ms, 2 s).
export const redisClientCreate = async (
	redisUrl: string,
): Promise<RedisClient> => {
	let connected = false;
	const redisClient: RedisClient = createClient({
		// node-redis drops this timer once a command is sent, so it only limits the wait to send.
		commandOptions: { timeout: 1_000 },
		socket: {
			connectTimeout: 3_000,
			reconnectStrategy: (retries) =>
				connected ? Math.min(retries * 100, 2_000) : false,
		},
		url: redisUrl,
	});
	// node-redis exits the process on an unlistened error event. Never log the URL: it may carry
	// a password.
	redisClient.on("error", (err: unknown) => {
		logger.error({ err }, "Redis client error");
	});
	await redisClient.connect();
	connected = true;
	return redisClient;
};
