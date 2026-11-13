// The connections every composition root opens: Postgres, and Redis, the cache store, the queue, Events, the live hub and
// analytics while the Project has those pieces. Each Domain's spi/index.ts picks its adapters
// from them.
// "memory" stands in for a connection whose URL is memory://.
import { postgresPoolCreate } from "@n8io/baseline-postgres";
import type { ShutdownStep } from "@n8io/baseline-shutdown";
import { analyticsOpen } from "./analytics-open.ts";
import { cacheStoreOpen } from "./cache-store-open.ts";
import { eventsOpen } from "./events-open.ts";
import { liveHubOpen } from "./live-hub-open.ts";
import { queueOpen } from "./queue-open.ts";
import { redisOpen } from "./redis.ts";

// Also lists how to close each connection, in the order shutdown closes them. The Worker's queue
// is an intake, since it brings work in; elsewhere the live hub is, since it streams out.
export const connectionsOpen = async (
	env: {
		DATABASE_URL: string;
		// piece-start: redis
		CACHE_URL: string;
		// piece-end: redis
		// piece-start: analytics
		MIXPANEL_TOKEN?: string;
		// piece-end: analytics
	},
	role: "publisher" | "worker",
) => {
	if (role === "worker" && env.DATABASE_URL === "memory://") {
		throw new Error(
			"The worker needs a real database: DATABASE_URL is memory://",
		);
	}
	const database =
		env.DATABASE_URL === "memory://"
			? ("memory" as const)
			: postgresPoolCreate({ databaseUrl: env.DATABASE_URL });
	const intakes: ShutdownStep[] = [];
	const resources: ShutdownStep[] = [];
	if (database !== "memory") {
		resources.push({ close: () => database.end(), name: "database" });
	}
	// piece-start: redis
	const redis = await redisOpen(env.CACHE_URL, resources);
	// piece-end: redis
	// piece-start: queue
	const queue = await queueOpen(
		database,
		role,
		role === "worker" ? intakes : resources,
	);
	// piece-end: queue
	return {
		// piece-start: analytics
		analytics: analyticsOpen(env.MIXPANEL_TOKEN, resources),
		// piece-end: analytics
		// piece-start: cache
		cacheStore: cacheStoreOpen(redis),
		// piece-end: cache
		database,
		intakes,
		// piece-start: live
		liveHub: liveHubOpen(redis, role === "worker" ? resources : intakes),
		// piece-end: live
		// piece-start: queue
		events: eventsOpen(queue),
		queue,
		// piece-end: queue
		// piece-start: redis
		// For a Project's own adapters. A Domain's cache goes through cacheStore instead.
		redis,
		// piece-end: redis
		resources,
	};
};

export type Connections = Awaited<ReturnType<typeof connectionsOpen>>;
