// The Redis connection the cache and live updates share. `pnpm piece-remove redis` deletes this
// file, once neither of them is left.
import { type RedisClient, redisClientCreate } from "@n8io/baseline-redis";
import { type ShutdownSteps, shutdownStepAdd } from "./shutdown-step-add.ts";

// "memory" for memory://, else a connected client that the steps it returns close at shutdown. An
// unreachable Redis fails startup; a dropped connection reconnects by itself.
export const redisOpen = async ({
	steps,
	url,
}: {
	steps: ShutdownSteps;
	url: string;
}): Promise<{ redis: RedisClient | "memory"; steps: ShutdownSteps }> => {
	if (url === "memory://") return { redis: "memory", steps };
	const redisClient = await redisClientCreate({ url });
	return {
		redis: redisClient,
		steps: shutdownStepAdd({
			at: "last",
			group: "resources",
			step: { close: () => redisClient.close(), name: "redis" },
			steps,
		}),
	};
};
