import { logger } from "@n8io/baseline-logger";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { PgBoss } from "pg-boss";
import { queueInboxPruneStart } from "./queue-inbox.ts";
import type { QueueSql } from "./queue-sql.ts";

export type Queue = {
	isAlive(): boolean;
	// Stops consumers and the cron pass and waits up to 15 s for running jobs. It leaves the pool open:
	// the composition root closes it after.
	stop(): Promise<void>;
};

// Every pg-boss table, function and queue lives in this Postgres schema, beside queue.inbox.
export const queueSchema = "queue";

// A worker with no completed poll for this long is reported dead to /livez.
const queueHeartbeatLimitMs = 60_000;

const queueBosses = new WeakMap<Queue, PgBoss>();

// The pg-boss instance behind a Queue, for the other modules of this package only.
export const queueBossGet = (queue: Queue): PgBoss => {
	const boss = queueBosses.get(queue);
	if (boss === undefined) {
		throw new TypeError("Expected a Queue from queueCreate");
	}
	return boss;
};

// Starts pg-boss on the shared pool. A publisher (the server) only sends: it runs no workers, no
// maintenance and no cron pass. A worker runs maintenance, cron and the package's inbox pruning.
export const queueCreate = async (options: {
	pgPool: QueueSql;
	role: "publisher" | "worker";
}): Promise<Queue> => {
	const { pgPool, role } = options;
	const worker = role === "worker";
	const boss = new PgBoss({
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
	boss.on("error", (error) => {
		logger.error({ err: error }, "Queue error");
	});
	boss.on("warning", (warning) => {
		logger.warn({ queueWarning: warning.data }, warning.message);
	});
	await boss.start();
	try {
		return await queueStarted(boss, worker);
	} catch (error) {
		// A half-started worker would keep polling the pool with nothing left to stop it.
		await boss.stop({ graceful: false });
		throw error;
	}
};

const queueStarted = async (boss: PgBoss, worker: boolean): Promise<Queue> => {
	const startedAt = Date.now();
	const queue: Queue = {
		isAlive: () => {
			if (!worker) {
				return true;
			}
			// Every completed poll, empty or not, stamps lastFetchedOn on its worker.
			const heartbeat = Math.max(
				startedAt,
				...boss.getWipData().map((wip) => wip.lastFetchedOn ?? 0),
			);
			return Date.now() - heartbeat < queueHeartbeatLimitMs;
		},
		stop: () => boss.stop({ graceful: true, timeout: 15_000 }),
	};
	queueBosses.set(queue, boss);
	if (worker) {
		await queueInboxPruneStart(boss);
	}
	return queue;
};
