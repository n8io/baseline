import { logger } from "@n8io/baseline-logger";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { type ConstructorOptions, PgBoss } from "pg-boss";
import { queueInboxPruneStart } from "./queue-inbox.ts";
import {
	queueOrderedBlockedKeysList,
	queueOrderedBlockedKeysWatch,
} from "./queue-ordered.ts";
import type { QueueSql } from "./queue-sql.ts";

export type Queue = {
	// false only when this process's own poll loops are stuck, which a restart fixes. A poll that
	// fails (Postgres is down or failing over) still counts as proof the loop runs, so an outage
	// never reports a worker dead.
	isAlive(): boolean;
	// The keys held back by an Event that failed for good, per Consumer (its queueName), and since
	// when. Empty when nothing is blocked. README, "A blocked key", says how to release one.
	blockedKeys(): Promise<{ consumer: string; key: string; since: Date }[]>;
	// Stops consumers and the cron pass and waits up to 15 s for running jobs. It leaves the pool open:
	// the composition root closes it after.
	stop(): Promise<void>;
	/** Calls stop(), so `await using` stops the queue when its block ends. */
	[Symbol.asyncDispose](): Promise<void>;
};

// Every pg-boss table, function and queue lives in this Postgres schema, beside queue.inbox.
export const queueSchema = "queue";

// A worker none of whose polls has ended, in a fetch or in an error, for this long is reported
// dead to /livez.
const queueHeartbeatLimitMs = 60_000;

// Events one process runs at once unless queueCreate is told otherwise.
const queueConcurrencyDefault = 4;

const queueBosses = new WeakMap<Queue, PgBoss>();
const queueConcurrencies = new WeakMap<Queue, number>();

// How many Events the Queue's process may run at once, for the other modules of this package only.
export const queueConcurrencyGet = (queue: Queue): number =>
	queueConcurrencies.get(queue) ?? queueConcurrencyDefault;

// The pg-boss instance behind a Queue, for the other modules of this package only.
export const queueBossGet = (queue: Queue): PgBoss => {
	const boss = queueBosses.get(queue);
	if (boss === undefined) {
		throw new TypeError("Expected a Queue from queueCreate");
	}
	return boss;
};

// pg-boss settings a `vendor` option may not carry, and why.
const queueSetsItself = "queueCreate sets it itself";
const queueRunsOnPool = "the queue runs on pgPool; set it on the pool";
const queueMigrateOnly = "it only acts in queueMigrate";
const queueUnsupported = "the queue does not support it";
type QueueOwnedKey =
	| "__test__enableSpies"
	| "allowSchemaCaseVariant"
	| "application_name"
	| "backend"
	| "bamIntervalSeconds"
	| "clock"
	| "connectionString"
	| "connectionTimeoutMillis"
	| "createSchema"
	| "database"
	| "db"
	| "host"
	| "max"
	| "migrate"
	| "notifyHeartbeatIntervalMs"
	| "notifyHeartbeatTimeoutMs"
	| "notifyKeepAliveInitialDelayMs"
	| "openTelemetry"
	| "options"
	| "password"
	| "port"
	| "schedule"
	| "schema"
	| "ssl"
	| "supervise"
	| "useListenNotify"
	| "user";
const queueOwnedKeys: Record<QueueOwnedKey, string> = {
	__test__enableSpies: queueUnsupported,
	allowSchemaCaseVariant: queueMigrateOnly,
	application_name: queueRunsOnPool,
	backend: queueUnsupported,
	bamIntervalSeconds: queueMigrateOnly,
	clock: queueUnsupported,
	connectionString: queueRunsOnPool,
	connectionTimeoutMillis: queueRunsOnPool,
	createSchema: queueMigrateOnly,
	database: queueRunsOnPool,
	db: queueSetsItself,
	host: queueRunsOnPool,
	max: queueRunsOnPool,
	migrate: queueSetsItself,
	notifyHeartbeatIntervalMs: queueUnsupported,
	notifyHeartbeatTimeoutMs: queueUnsupported,
	notifyKeepAliveInitialDelayMs: queueUnsupported,
	openTelemetry: queueSetsItself,
	options: queueRunsOnPool,
	password: queueRunsOnPool,
	port: queueRunsOnPool,
	schedule: queueSetsItself,
	schema: queueSetsItself,
	ssl: queueRunsOnPool,
	supervise: queueSetsItself,
	useListenNotify: queueUnsupported,
	user: queueRunsOnPool,
};

/**
 * pg-boss's own settings, passed through as they are: its intervals, warnings and retention.
 * Outside this Package's contract: nothing here is tested, and moving off pg-boss deletes it.
 * Connection settings and the keys queueCreate sets are refused.
 */
export type QueueVendorOptions = Omit<ConstructorOptions, QueueOwnedKey>;

// Starts pg-boss on the shared pool. A publisher (the server) only sends: it runs no workers, no
// maintenance and no cron pass. A worker runs maintenance, cron and the package's inbox pruning.
export const queueCreate = async (options: {
	/**
	 * How many Events a worker runs at once, across all its Consumers. Default 4. Each one holds a
	 * connection of `pgPool` while its transaction is open, so keep it below the pool's size.
	 */
	concurrency?: number;
	pgPool: QueueSql;
	role: "publisher" | "worker";
	/** Settings only pg-boss has, such as `monitorIntervalSeconds`. */
	vendor?: QueueVendorOptions;
}): Promise<Queue> => {
	const {
		concurrency = queueConcurrencyDefault,
		pgPool,
		role,
		vendor = {},
	} = options;
	if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
		throw new TypeError("concurrency must be a positive integer");
	}
	for (const [key, reason] of Object.entries(queueOwnedKeys)) {
		if (key in vendor) {
			throw new TypeError(`vendor.${key} is not allowed: ${reason}`);
		}
	}
	const worker = role === "worker";
	const boss = new PgBoss({
		...vendor,
		db: { executeSql: (text, values) => pgPool.query(text, values) },
		migrate: false,
		openTelemetry: {
			propagateContext: true,
			// Trace context only: baggage never reaches the job table.
			propagator: new W3CTraceContextPropagator(),
		},
		schedule: worker,
		schema: queueSchema,
		supervise: worker,
	});
	// pg-boss reports background failures (a poll, maintenance) as events; unhandled, they would
	// crash the process.
	boss.on("error", (error) => queueErrorHandle(boss, error));
	boss.on("warning", (warning) => {
		logger.warn({ queueWarning: warning.data }, warning.message);
	});
	await boss.start();
	try {
		const queue = await queueStarted(boss, worker);
		queueConcurrencies.set(queue, concurrency);
		return queue;
	} catch (error) {
		// A half-started worker would keep polling the pool with nothing left to stop it.
		await boss.stop({ graceful: false });
		throw error;
	}
};

// pg-boss's code for a poll of a queue that is no longer there.
const queueGoneCode = "PGBOSS_QUEUE_NOT_FOUND";

// pg-boss hands most background failures over as plain objects, which a logger and error tracking
// print without a message or a stack: each becomes an Error, with what pg-boss sent as its cause.
// A worker whose queue is gone (queueMigrate removed it under a process that still works it)
// stops polling it and says so once, instead of failing the same poll until the process restarts.
const queueErrorHandle = (boss: PgBoss, error: unknown): void => {
	const { code, message, queue, stack } = (error ?? {}) as Record<
		string,
		unknown
	>;
	if (code === queueGoneCode && typeof queue === "string") {
		logger.warn({ queue }, "Queue was removed; this worker stops polling it");
		boss.offWork(queue, { wait: false }).catch(() => undefined);
		return;
	}
	let err = error;
	if (!(error instanceof Error)) {
		err = new Error(typeof message === "string" ? message : "Queue error", {
			cause: error,
		});
		if (typeof stack === "string") {
			(err as Error).stack = stack;
		}
	}
	logger.error(
		{ err, ...(typeof queue === "string" && { queue }) },
		"Queue error",
	);
};

const queueStarted = async (boss: PgBoss, worker: boolean): Promise<Queue> => {
	const startedAt = Date.now();
	let blockedKeysWatchStop = (): void => undefined;
	const stop = (): Promise<void> => {
		blockedKeysWatchStop();
		return boss.stop({ graceful: true, timeout: 15_000 });
	};
	const queue: Queue = {
		blockedKeys: () => queueOrderedBlockedKeysList(boss),
		isAlive: () => {
			if (!worker) {
				return true;
			}
			// Every poll that ends stamps its worker: lastFetchedOn when it fetched, empty or not, and
			// lastErrorOn when it failed. A poll that hangs stamps neither.
			const heartbeat = Math.max(
				startedAt,
				...boss
					.getWipData()
					.flatMap((wip) => [wip.lastFetchedOn ?? 0, wip.lastErrorOn ?? 0]),
			);
			return Date.now() - heartbeat < queueHeartbeatLimitMs;
		},
		stop,
		[Symbol.asyncDispose]: stop,
	};
	queueBosses.set(queue, boss);
	if (worker) {
		await queueInboxPruneStart(boss);
		blockedKeysWatchStop = queueOrderedBlockedKeysWatch(boss);
	}
	return queue;
};
