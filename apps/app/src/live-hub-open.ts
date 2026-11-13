// The live hub for a composition root: on Redis, so every process sees every live update, or in
// memory for memory://. `pnpm piece-remove live` deletes this file.
import {
	type LiveHub,
	liveHubMemoryCreate,
	liveHubRedisCreate,
} from "@n8io/baseline-live";
import type { ShutdownStep } from "@n8io/baseline-shutdown";
import type { RedisClient } from "./redis.ts";

// `steps` closes the hub at shutdown, before what is already in it.
export const liveHubOpen = ({
	redis,
	steps,
}: {
	redis: RedisClient | "memory";
	steps: ShutdownStep[];
}): LiveHub => {
	const liveHub =
		redis === "memory"
			? liveHubMemoryCreate()
			: liveHubRedisCreate({ redisClient: redis });
	steps.unshift({ close: () => liveHub.close(), name: "live" });
	return liveHub;
};
