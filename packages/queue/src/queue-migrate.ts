import { sharedIntegerAssert, sharedTimerMaxMs } from "@n8io/baseline-shared";
import { type ConstructorOptions, PgBoss } from "pg-boss";
import { queueSchema } from "./queue.ts";
import { queueConnectionAssert } from "./queue-connection-assert.ts";
import { queueInboxTableSql } from "./queue-inbox.ts";
import { queueLoggerDefault as logger } from "./queue-logger-default.ts";
import { queueMigrateIndexesWait } from "./queue-migrate-indexes-wait.ts";
import { queueOrderedName } from "./queue-ordered.ts";

/**
 * Settings for the connection pg-boss opens to migrate or sync Schedules, passed through as they
 * are: `ssl`, `application_name` and `options` only; any other key is refused. Outside this
 * Package's contract, like `QueueVendorOptions`.
 */
export type QueueMigrateVendorOptions = Pick<
	ConstructorOptions,
	"application_name" | "options" | "ssl"
>;

/** What `queueMigrate` takes. */
export type QueueMigrateOptions = {
	/** The Postgres URL, `postgres://` or `postgresql://`. */
	databaseUrl: string;
	/**
	 * How long to wait for pg-boss's background index builds before throwing. Default: 600000 (10
	 * minutes), a finite deadline so a stuck build fails the deploy instead of hanging it. Pass a
	 * larger value for a longer wait; there is no unlimited value. At most 2147483647.
	 */
	indexesDeadlineMs?: number | null;
	/** The `queueName` of each Consumer an earlier release removed: its queues are deleted. */
	queuesRemoved?: readonly string[] | null;
	/** Settings only pg-boss's own connection has, such as `ssl`. */
	vendor?: QueueMigrateVendorOptions | null;
};

/**
 * Installs or upgrades pg-boss in schema `queue`, waits for its background index builds, deletes
 * the queues of Consumers removed in an earlier release, and creates queue.inbox. Runs from the
 * migrate entry, before any Server or Worker starts with `migrate: false`; queueSchedulesSync
 * runs after it. Throws a TypeError at the call on a `databaseUrl` that is not a Postgres URL, on an
 * `indexesDeadlineMs` that is not a whole number from 1 to 2147483647, or on a `vendor` key other than `ssl`, `application_name` and `options`, or `vendor.ssl` together
 * with TLS in the URL. Rejects with an `Error` that starts `queueMigrate:` when the index builds
 * are still running after `indexesDeadlineMs` (default 10 minutes).
 */
export const queueMigrate = async (
	options: QueueMigrateOptions,
): Promise<void> => {
	const vendor = options.vendor ?? {};
	queueConnectionAssert({
		caller: "queueMigrate",
		databaseUrl: options.databaseUrl,
		vendor,
	});
	const indexesDeadlineMs = options.indexesDeadlineMs ?? null;
	if (indexesDeadlineMs !== null) {
		sharedIntegerAssert({
			caller: "queueMigrate",
			max: sharedTimerMaxMs,
			min: 1,
			name: "indexesDeadlineMs",
			value: indexesDeadlineMs,
		});
	}
	const boss = new PgBoss({
		...vendor,
		bamIntervalSeconds: 10,
		connectionString: options.databaseUrl,
		max: 2,
		migrate: true,
		registerInstance: false,
		schedule: false,
		schema: queueSchema,
		supervise: false,
	});
	boss.on("error", (error) => {
		logger.error({ err: error }, "Queue migrate error");
	});
	try {
		await boss.start();
		await queueMigrateIndexesWait({ boss, deadlineMs: indexesDeadlineMs });
		for (const name of options.queuesRemoved ?? []) {
			await boss.deleteQueue(queueOrderedName(name));
			// A Schedule's queue has the plain name, and pg-boss refuses to delete `.dead` while
			// a queue still points at it, so the plain one goes first.
			await boss.deleteQueue(name);
			await boss.deleteQueue(`${name}.dead`);
		}
		await boss.getDb().executeSql(queueInboxTableSql);
	} finally {
		await boss.stop({ graceful: true, timeout: 15_000 });
	}
};
