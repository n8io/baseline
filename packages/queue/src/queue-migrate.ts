import { setTimeout } from "node:timers/promises";
import { logger } from "@n8io/baseline-logger";
import { PgBoss } from "pg-boss";
import { queueSchema } from "./queue-create.ts";
import { queueInboxTableCreate } from "./queue-inbox.ts";

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

// Installs or upgrades pg-boss in schema `queue`, waits for its background index builds, deletes
// the queues of consumers removed in an earlier release, and creates queue.inbox. Runs from the
// migrate entry, before any server or worker starts with `migrate: false`.
export const queueMigrate = async (options: {
	databaseUrl: string;
	queuesRemoved?: string[];
}): Promise<void> => {
	queueUrlAssert(options.databaseUrl);
	const boss = new PgBoss({
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
	await boss.start();
	try {
		for (;;) {
			const status = await boss.getBamStatus();
			const failed = status.find((row) => row.status === "failed");
			if (failed) {
				throw new Error(`pg-boss migration failed: ${failed.count} command(s)`);
			}
			if (
				!boss.isBamWorking() &&
				!status.some((row) => ["pending", "in_progress"].includes(row.status))
			) {
				break;
			}
			await setTimeout(1_000);
		}
		for (const name of options.queuesRemoved ?? []) {
			await boss.deleteQueue(name);
			await boss.deleteQueue(`${name}.dead`);
		}
		await boss.getDb().executeSql(queueInboxTableCreate);
	} finally {
		await boss.stop({ graceful: true, timeout: 15_000 });
	}
};
