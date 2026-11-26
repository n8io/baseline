// The connections every entry point opens: Postgres, and Redis, the cache store, the queue, Events, the live hub,
// analytics, error tracking and feature flags while the Project has those pieces, and the clock. Each context's adapters/outbound/index.ts picks its adapters
// from them.
// "memory" stands in for a connection whose URL is memory://.
import { postgresPoolCreate } from "@n8io/baseline-postgres";
import type { ShutdownStep } from "@n8io/baseline-shutdown";
import { ENV } from "#env";
import { analyticsOpen } from "./analytics-open.ts";
import { cacheStoreOpen } from "./cache-store-open.ts";
import { clockSystemCreate } from "./clock.ts";
import { errorTrackingOpen } from "./error-tracking-open.ts";
import { featureFlagsOpen } from "./feature-flags-open.ts";
import { liveHubOpen } from "./live-hub-open.ts";
import { queueOpen } from "./queue-open.ts";
import { redisOpen } from "./redis-open.ts";
import { type ShutdownSteps, shutdownStepAdd } from "./shutdown-step-add.ts";

// The Postgres pool. Everything in a process shares it, so `max` is every Postgres connection the
// process opens: DATABASE_POOL_MAX, else 10 in the Server and 5 in the Worker. It returns that
// `poolMax` beside the pool, so nothing reads it back out of the driver's own options.
export const databaseOpen = ({
	poolMax,
	role,
	url,
}: {
	poolMax?: number | null;
	role: "publisher" | "worker";
	url: string;
}) => {
	const max = poolMax ?? (role === "worker" ? 5 : 10);
	return {
		database:
			url === "memory://"
				? ("memory" as const)
				: postgresPoolCreate({ databaseUrl: url, max }),
		poolMax: max,
	};
};

// Also lists how to close each connection, in the order shutdown closes them. The Worker's queue
// is an intake, since it brings work in; elsewhere the live hub is, since it streams out.
// `role` is the queue's word: the Worker is "worker", and every other process (the Server, seed,
// blocked-keys) only publishes, so it is "publisher".
// `urls` is for a test that needs a real database (or cache) whatever the variables say: it replaces
// DATABASE_URL and CACHE_URL, and a field left out keeps the variable's value. A real database makes
// the queue and Events real too.
export const connectionsOpen = async ({
	role,
	urls,
}: {
	role: "publisher" | "worker";
	urls?: { cache?: string | null; database?: string | null } | null;
}) => {
	const databaseUrl = urls?.database ?? ENV.DATABASE_URL;
	if (role === "worker" && databaseUrl === "memory://") {
		throw new Error(
			"The Worker needs a real database: DATABASE_URL is memory://",
		);
	}
	const { database, poolMax } = databaseOpen({
		poolMax: ENV.DATABASE_POOL_MAX ?? null,
		role,
		url: databaseUrl,
	});
	if (database !== "memory") {
		// The startup check: while Postgres is unreachable this throws, boot fails and the process
		// never reports ready, so a new pod does not start during an outage. A pod already running
		// is not checked again: its probes do not ask Postgres, so an outage never restarts it.
		await database.query("SELECT 1");
	}
	// Each opener returns the steps so far with its own added, in the order they close.
	let steps: ShutdownSteps = { intakes: [], resources: [] };
	// piece-start: error-tracking
	// First, so it reports what the other connections log while they open. It closes first too.
	steps = errorTrackingOpen({
		dsn: ENV.SENTRY_DSN ?? null,
		environment: ENV.APP_ENV,
		steps,
	});
	// piece-end: error-tracking
	if (database !== "memory") {
		steps = shutdownStepAdd({
			at: "last",
			group: "resources",
			step: { close: () => database.end(), name: "database" },
			steps,
		});
	}
	// piece-start: redis
	const redisOpened = await redisOpen({
		steps,
		url: urls?.cache ?? ENV.CACHE_URL,
	});
	const { redis } = redisOpened;
	steps = redisOpened.steps;
	// piece-end: redis
	// piece-start: analytics
	const analyticsOpened = analyticsOpen({
		steps,
		token: ENV.MIXPANEL_TOKEN ?? null,
	});
	steps = analyticsOpened.steps;
	// piece-end: analytics
	// piece-start: feature-flags
	const featureFlagsOpened = featureFlagsOpen({
		sdkKey: ENV.LAUNCHDARKLY_SDK_KEY ?? null,
		steps,
	});
	steps = featureFlagsOpened.steps;
	// piece-end: feature-flags
	// piece-start: live
	const liveHubOpened = liveHubOpen({ redis, role, steps });
	steps = liveHubOpened.steps;
	// piece-end: live
	// piece-start: queue
	const { steps: queueSteps, ...queueConnections } = await queueOpen({
		database,
		poolMax,
		role,
		steps,
	});
	steps = queueSteps;
	// piece-end: queue
	return {
		// piece-start: analytics
		analytics: analyticsOpened.analytics,
		// piece-end: analytics
		// piece-start: cache
		cacheStore: cacheStoreOpen({ redis }),
		// piece-end: cache
		// The time every context reads. A test replaces it with clockMemoryCreate to set the time.
		clock: clockSystemCreate(),
		database,
		// piece-start: feature-flags
		featureFlags: featureFlagsOpened.featureFlags,
		// piece-end: feature-flags
		intakes: steps.intakes,
		// piece-start: live
		liveHub: liveHubOpened.liveHub,
		// piece-end: live
		// piece-start: queue
		// `events` and `queue`.
		...queueConnections,
		// piece-end: queue
		// piece-start: redis
		// For a Project's own adapters. A bounded context's cache goes through cacheStore instead.
		redis,
		// piece-end: redis
		resources: steps.resources,
	};
};

export type Connections = Awaited<ReturnType<typeof connectionsOpen>>;

// Closes the shutdown steps of opened connections, in shutdown's order: intakes, then resources. For a process
// that ends on its own (a script, the dev server's re-run); a long-lived one closes through
// shutdownHandleCreate instead.
export const connectionsClose = async ({
	intakes,
	resources,
}: {
	intakes: ShutdownStep[];
	resources: ShutdownStep[];
}): Promise<void> => {
	for (const step of [...intakes, ...resources]) await step.close();
};
