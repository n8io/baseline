import { setTimeout } from "node:timers/promises";
import { logger } from "@n8io/baseline-logger";
import { type ConstructorOptions, PgBoss } from "pg-boss";
import { queueSchema } from "./queue.ts";
import { queueInboxTableCreate } from "./queue-inbox.ts";
import { queueOrderedName } from "./queue-ordered.ts";

// Only Postgres URLs; the composition root handles memory:// first. Never echoes the URL.
const queueUrlAssert = (databaseUrl: string): void => {
	if (/^postgres(ql)?:\/\//.test(databaseUrl)) {
		return;
	}
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(databaseUrl)?.[1];
	const found = scheme ? `"${scheme}://"` : "no scheme";
	throw new TypeError(
		`Invalid database URL: found ${found}; use postgres:// or postgresql://`,
	);
};

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

// The unordered Consumer queues of a release before 8 that are done: the ordered queue beside it
// exists, nothing in it is waiting or running, and nothing was published to it for a day, so no
// process of that release is still running. A queue that is not there yet waits for a later run.
const queueUnorderedDone = `
	SELECT q.name FROM queue.queue q
	WHERE q.policy = 'standard'
		AND EXISTS (SELECT FROM queue.queue o WHERE o.name = q.name || '.ordered')
		AND NOT EXISTS (
			SELECT FROM queue.job j WHERE j.name = q.name
				AND (j.state < 'completed' OR j.created_on > now() - interval '1 day')
		)`;

/**
 * Settings for the connection pg-boss opens to migrate, passed through as they are. Outside this
 * Package's contract, like `QueueVendorOptions`.
 */
export type QueueMigrateVendorOptions = Pick<
	ConstructorOptions,
	"application_name" | "options" | "ssl"
>;

// Installs or upgrades pg-boss in schema `queue`, waits for its background index builds, deletes
// the queues of consumers removed in an earlier release and the unordered queues an upgrade to
// release 8 left behind, and creates queue.inbox. Runs from the migrate entry, before any server
// or worker starts with `migrate: false`.
export const queueMigrate = async (options: {
	databaseUrl: string;
	queuesRemoved?: string[];
	/** Settings only pg-boss's own connection has, such as `ssl`. */
	vendor?: QueueMigrateVendorOptions;
}): Promise<void> => {
	queueUrlAssert(options.databaseUrl);
	const boss = new PgBoss({
		...options.vendor,
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
			await boss.deleteQueue(name);
			await boss.deleteQueue(`${name}.dead`);
		}
		const unordered = await boss.getDb().executeSql(queueUnorderedDone);
		for (const { name } of unordered.rows as { name: string }[]) {
			await boss.deleteQueue(name);
		}
		await boss.getDb().executeSql(queueInboxTableCreate);
	} finally {
		await boss.stop({ graceful: true, timeout: 15_000 });
	}
};
