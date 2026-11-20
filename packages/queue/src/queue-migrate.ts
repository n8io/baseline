import { setTimeout } from "node:timers/promises";
import { logger } from "@n8io/baseline-logger";
import { type ConstructorOptions, PgBoss } from "pg-boss";
import { queueSchema } from "./queue.ts";
import { queueConnectionAssert } from "./queue-connection-assert.ts";
import { queueInboxTableSql } from "./queue-inbox.ts";
import { queueOrderedName } from "./queue-ordered.ts";

// Waits for pg-boss's background index builds (bam) to finish. A build that failed, in this run or
// an earlier one, is retried by the next migrate run; the schema version is already current, so it
// only costs speed, and boot goes on with a warning.
const queueMigrateIndexesWait = async (boss: PgBoss): Promise<void> => {
	// The first bam poll starts on the next turn of the event loop after start().
	await setTimeout(100);
	for (;;) {
		const status = await boss.getBamStatus();
		const busy = status.some((row) =>
			["pending", "in_progress"].includes(row.status),
		);
		if (!busy && !boss.isBamWorking()) {
			const failed = status.find((row) => row.status === "failed");
			if (failed) {
				logger.warn(
					{ queueIndexBuildsFailed: failed.count },
					"Queue index builds failed; the next migrate retries them",
				);
			}
			return;
		}
		await setTimeout(1_000);
	}
};

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
	databaseUrl: string;
	/** The `queueName` of each Consumer an earlier release removed: its queues are deleted. */
	queuesRemoved?: string[] | null;
	/** Settings only pg-boss's own connection has, such as `ssl`. */
	vendor?: QueueMigrateVendorOptions | null;
};

/**
 * Installs or upgrades pg-boss in schema `queue`, waits for its background index builds, deletes
 * the queues of Consumers removed in an earlier release, and creates queue.inbox. Runs from the
 * migrate entry, before any server or worker starts with `migrate: false`; queueSchedulesSync
 * runs after it.
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
		await queueMigrateIndexesWait(boss);
		for (const name of options.queuesRemoved ?? []) {
			await boss.deleteQueue(queueOrderedName(name));
			await boss.deleteQueue(`${name}.dead`);
		}
		await boss.getDb().executeSql(queueInboxTableSql);
	} finally {
		await boss.stop({ graceful: true, timeout: 15_000 });
	}
};
