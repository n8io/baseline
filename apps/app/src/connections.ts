// The connections every composition root opens: Postgres, and Redis, the cache store, the queue, Events, the live hub,
// analytics and error tracking while the Project has those pieces. Each Domain's spi/index.ts picks its adapters
// from them.
// "memory" stands in for a connection whose URL is memory://.
import { postgresPoolCreate } from "@n8io/baseline-postgres";
import type { ShutdownStep } from "@n8io/baseline-shutdown";
import { ENV } from "#env";
import { analyticsOpen } from "./analytics-open.ts";
import { cacheStoreOpen } from "./cache-store-open.ts";
import { errorTrackingOpen } from "./error-tracking-open.ts";
import { liveHubOpen } from "./live-hub-open.ts";
import { queueOpen } from "./queue-open.ts";
import { redisOpen } from "./redis.ts";

// Also lists how to close each connection, in the order shutdown closes them. The Worker's queue
// is an intake, since it brings work in; elsewhere the live hub is, since it streams out.
export const connectionsOpen = async ({
	role,
}: {
	role: "publisher" | "worker";
}) => {
	if (role === "worker" && ENV.DATABASE_URL === "memory://") {
		throw new Error(
			"The worker needs a real database: DATABASE_URL is memory://",
		);
	}
	const database =
		ENV.DATABASE_URL === "memory://"
			? ("memory" as const)
			: postgresPoolCreate({ databaseUrl: ENV.DATABASE_URL });
	const intakes: ShutdownStep[] = [];
	const resources: ShutdownStep[] = [];
	// piece-start: error-tracking
	// First, so it reports what the other connections log while they open. It closes first too.
	errorTrackingOpen({
		dsn: ENV.SENTRY_DSN,
		environment: ENV.APP_ENV,
		steps: resources,
	});
	// piece-end: error-tracking
	if (database !== "memory") {
		resources.push({ close: () => database.end(), name: "database" });
	}
	// piece-start: redis
	const redis = await redisOpen({ steps: resources, url: ENV.CACHE_URL });
	// piece-end: redis
	return {
		// piece-start: analytics
		analytics: analyticsOpen({ steps: resources, token: ENV.MIXPANEL_TOKEN }),
		// piece-end: analytics
		// piece-start: cache
		cacheStore: cacheStoreOpen({ redis }),
		// piece-end: cache
		database,
		intakes,
		// piece-start: live
		liveHub: liveHubOpen({
			redis,
			steps: role === "worker" ? resources : intakes,
		}),
		// piece-end: live
		// piece-start: queue
		// `events` and `queue`.
		...(await queueOpen({ database, intakes, resources, role })),
		// piece-end: queue
		// piece-start: redis
		// For a Project's own adapters. A Domain's cache goes through cacheStore instead.
		redis,
		// piece-end: redis
		resources,
	};
};

export type Connections = Awaited<ReturnType<typeof connectionsOpen>>;
