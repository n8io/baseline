// The Redis connection the cache and live updates share. `pnpm piece-remove redis` deletes this
// file, once neither of them is left.
import { type RedisClient, redisClientCreate } from "@n8io/baseline-redis";
import type { ShutdownStep } from "@n8io/baseline-shutdown";

// "memory" for memory://, else a connected client that `steps` closes at shutdown. An unreachable
// Redis fails startup; a dropped connection reconnects by itself.
export const redisOpen = async ({
	steps,
	url,
}: {
	steps: ShutdownStep[];
	url: string;
}): Promise<RedisClient | "memory"> => {
	if (url === "memory://") return "memory";
	const redisClient = await redisClientCreate({ url });
	steps.push({ close: () => redisClient.close(), name: "redis" });
	return redisClient;
};
