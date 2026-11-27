import { setTimeout } from "node:timers/promises";
import type { PgBoss } from "pg-boss";
import { queueLoggerDefault as logger } from "./queue-logger-default.ts";

/** The part of pg-boss that the wait reads. */
export type QueueMigrateIndexesBoss = Pick<
	PgBoss,
	"getBamStatus" | "isBamWorking"
>;

/**
 * How long `queueMigrate` waits for the index builds when the caller sets no deadline: 10 minutes.
 * It is well above a normal pg-boss index build on the largest table we expect (a build of tens of
 * millions of job rows takes a few minutes), so a healthy migrate never hits it, and it is finite so
 * a stuck build (a lock held by another session, a dead connection) fails the deploy instead of
 * hanging it. A caller that wants a longer wait passes `indexesDeadlineMs`; there is no unlimited
 * value.
 */
export const queueMigrateIndexesDeadlineMsDefault = 600_000;

/**
 * Waits for pg-boss's background index builds (bam) to finish, polling every `pollMs` (default
 * 1000). A build that failed, in this run or an earlier one, is retried by the next migrate run;
 * the schema version is already current, so it only costs speed, and boot goes on with a warning.
 * Throws an `Error` that starts `queueMigrate:` when the builds are still busy after `deadlineMs`
 * (default `queueMigrateIndexesDeadlineMsDefault`, 10 minutes).
 */
export const queueMigrateIndexesWait = async ({
	boss,
	deadlineMs: deadlineMsOption,
	nowMs,
	pollMs,
	startMs,
}: {
	boss: QueueMigrateIndexesBoss;
	/** Give up after this many ms. Default: `queueMigrateIndexesDeadlineMsDefault`. */
	deadlineMs?: number | null;
	/** The clock, in ms. Default `Date.now`; tests pass their own to skip the real wait. */
	nowMs?: (() => number) | null;
	pollMs?: number | null;
	/** How long to wait before the first poll. Default 100. */
	startMs?: number | null;
}): Promise<void> => {
	const deadlineMs = deadlineMsOption ?? queueMigrateIndexesDeadlineMsDefault;
	const now = nowMs ?? Date.now;
	const startedAt = now();
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
				logger().warn(
					{ queueIndexBuildsFailed: failed.count },
					"Queue index builds failed; the next migrate retries them",
				);
			}
			return;
		}
		if (now() - startedAt >= deadlineMs) {
			throw new Error(
				`queueMigrate: index builds still running after ${deadlineMs} ms`,
			);
		}
		await setTimeout(pollMs ?? 1_000);
	}
};
