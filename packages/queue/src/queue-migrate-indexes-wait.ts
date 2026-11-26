import { setTimeout } from "node:timers/promises";
import { logger } from "@n8io/baseline-logger";
import type { PgBoss } from "pg-boss";

/** The part of pg-boss that the wait reads. */
export type QueueMigrateIndexesBoss = Pick<
	PgBoss,
	"getBamStatus" | "isBamWorking"
>;

/**
 * Waits for pg-boss's background index builds (bam) to finish, polling every `pollMs` (default
 * 1000). A build that failed, in this run or an earlier one, is retried by the next migrate run;
 * the schema version is already current, so it only costs speed, and boot goes on with a warning.
 * With `deadlineMs` set, throws an `Error` that starts `queueMigrate:` when the builds are still busy
 * after it; without one, waits as long as the builds take.
 */
export const queueMigrateIndexesWait = async ({
	boss,
	deadlineMs,
	pollMs,
	startMs,
}: {
	boss: QueueMigrateIndexesBoss;
	/** Give up after this many ms. Default: wait for as long as the builds take. */
	deadlineMs?: number | null;
	pollMs?: number | null;
	/** How long to wait before the first poll. Default 100. */
	startMs?: number | null;
}): Promise<void> => {
	const startedAt = Date.now();
	// The first bam poll starts on the next turn of the event loop after start().
	await setTimeout(startMs ?? 100);
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
		if (deadlineMs != null && Date.now() - startedAt >= deadlineMs) {
			throw new Error(
				`queueMigrate: index builds still running after ${deadlineMs} ms`,
			);
		}
		await setTimeout(pollMs ?? 1_000);
	}
};
