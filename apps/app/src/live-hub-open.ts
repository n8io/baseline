// The live hub for an entry point: on Redis, so every process sees every live update, or in
// memory for memory://. `pnpm piece-remove live` deletes this file.
import {
	type LiveHub,
	liveHubMemoryCreate,
	liveHubRedisCreate,
} from "@n8io/baseline-live";
import type { RedisClient } from "@n8io/baseline-redis";
import { resourceOpen, type ShutdownSteps } from "./shutdown-step-add.ts";

// The steps it returns close the hub at shutdown, before what is already in them: with the
// resources in the Worker, else with the intakes, since the hub streams out.
export const liveHubOpen = ({
	redis,
	role,
	steps,
}: {
	redis: RedisClient | "memory";
	role: "publisher" | "worker";
	steps: ShutdownSteps;
}): { liveHub: LiveHub; steps: ShutdownSteps } => {
	const liveHub =
		redis === "memory"
			? liveHubMemoryCreate()
			: liveHubRedisCreate({ redisClient: redis });
	return {
		liveHub,
		steps: resourceOpen({
			at: "first",
			group: role === "worker" ? "resources" : "intakes",
			name: "live",
			resource: liveHub,
			steps,
		}),
	};
};
