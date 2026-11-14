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
import { redisOpen } from "./redis-open.ts";

// The Postgres pool. Everything in a process shares it, so `max` is every Postgres connection the
// process opens: DATABASE_POOL_MAX, else 10 in the Server and 5 in the Worker.
export const databaseOpen = ({
	role,
	url,
}: {
	role: "publisher" | "worker";
	url: string;
}) =>
	url === "memory://"
		? ("memory" as const)
		: postgresPoolCreate({
				databaseUrl: url,
				max: ENV.DATABASE_POOL_MAX ?? (role === "worker" ? 5 : 10),
			});

// Also lists how to close each connection, in the order shutdown closes them. The Worker's queue
// is an intake, since it brings work in; elsewhere the live hub is, since it streams out.
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
			"The worker needs a real database: DATABASE_URL is memory://",
		);
	}
	const database = databaseOpen({ role, url: databaseUrl });
	if (database !== "memory") {
		// The startup check: while Postgres is unreachable this throws, boot fails and the process
		// never reports ready, so a new pod does not start during an outage. A pod already running
		// is not checked again: its probes do not ask Postgres, so an outage never restarts it.
		await database.query("SELECT 1");
	}
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
	const redis = await redisOpen({
		steps: resources,
		url: urls?.cache ?? ENV.CACHE_URL,
	});
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
