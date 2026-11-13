import { logger } from "@n8io/baseline-logger";
import type { Result } from "@n8io/baseline-result";
import { PgBoss } from "pg-boss";
import {
	type Queue,
	queueBossGet,
	queueErrorWrap,
	queueSchema,
} from "./queue.ts";
import { queueJobRun } from "./queue-job-run.ts";
import {
	type QueueMigrateVendorOptions,
	queueUrlAssert,
} from "./queue-migrate.ts";
import { queueWithDeadLetterCreate } from "./queue-retry.ts";
import { queueSlotsGet } from "./queue-slots.ts";

export type Schedule = {
	readonly name: string;
	readonly cron: string;
	readonly run: () => Promise<Result<unknown, { type: string }>>;
};

// name is `<domain>.<use case words, kebab>` (foo.stale-archive); cron is UTC, minute precision.
export const queueScheduleCreate = ({
	cron,
	name,
	run,
}: {
	cron: string;
	name: string;
	run: () => Promise<Result<unknown, { type: string }>>;
}): Schedule => ({ cron, name, run });

// foo.stale-archive → SCHEDULE_FOO_STALE_ARCHIVE
export const queueScheduleEnvName = (name: string): string =>
	`SCHEDULE_${name.toUpperCase().replaceAll(/[.-]/g, "_")}`;

// A Schedule's override in the composition root's ENV (or any object): a cron, or `off`. An
// undeclared or non-string item means none.
const scheduleOverride = (env: object, name: string): string | undefined => {
	const value: unknown = Reflect.get(env, queueScheduleEnvName(name));
	return typeof value === "string" ? value : undefined;
};

/**
 * Makes the Schedules the database holds match the ones in code: adds each, updates its cron, and
 * removes any that is no longer listed or is turned `off`. Every cron is validated before anything
 * changes. Runs from the migrate entry, after queueMigrate, so once per rollout and with the newest
 * code: a worker of the previous version that boots mid-rollout changes nothing.
 */
export const queueSchedulesSync = async ({
	databaseUrl,
	env,
	schedules,
	vendor,
}: {
	databaseUrl: string;
	// The composition root's ENV: `SCHEDULE_<NAME>` overrides a cron, or turns the Schedule `off`.
	env: object;
	schedules: Pick<Schedule, "cron" | "name">[];
	/** Settings only pg-boss's own connection has, such as `ssl`. */
	vendor?: QueueMigrateVendorOptions;
}): Promise<void> => {
	queueUrlAssert(databaseUrl);
	const boss = new PgBoss({
		...vendor,
		connectionString: databaseUrl,
		max: 2,
		migrate: false,
		registerInstance: false,
		schedule: false,
		schema: queueSchema,
		supervise: false,
	});
	boss.on("error", (error) => {
		logger.error({ err: queueErrorWrap(error) }, "Queue schedules sync error");
	});
	try {
		await boss.start();
		const active: { cron: string; name: string }[] = [];
		for (const { cron, name } of schedules) {
			const override = scheduleOverride(env, name);
			if (override === "off") {
				continue;
			}
			try {
				boss.previewSchedule(override ?? cron, { count: 1, from: new Date() });
			} catch (error) {
				const source =
					override === undefined
						? `schedule ${name}`
						: queueScheduleEnvName(name);
				throw new TypeError(
					`Invalid cron for ${source}: use a cron string or off`,
					{ cause: error },
				);
			}
			active.push({ cron: override ?? cron, name });
		}
		for (const { cron, name } of active) {
			// exclusive: one job queued or active, so a tick while a run is active is skipped.
			await queueWithDeadLetterCreate({ boss, name, policy: "exclusive" });
			await boss.schedule(name, cron, null, { missed: "once", tz: "UTC" });
		}
		const names = new Set(active.map(({ name }) => name));
		for (const held of await boss.getSchedules()) {
			// The `queue.` namespace is the package's own (inbox pruning).
			if (!names.has(held.name) && !held.name.startsWith("queue.")) {
				await boss.unschedule(held.name, held.key);
			}
		}
	} finally {
		await boss.stop({ graceful: true, timeout: 15_000 });
	}
};

// Starts running each Schedule (worker process only). It changes nothing in the database: a
// Schedule that queueSchedulesSync has not added there is not started, with a warning, since it
// would never fire. One turned `off` is skipped silently. The cron overrides are not read here:
// they act where queueSchedulesSync runs.
export const queueSchedulesStart = async ({
	env,
	queue,
	schedules,
}: {
	// The composition root's ENV, for the `off` overrides.
	env: object;
	queue: Queue;
	schedules: Schedule[];
}): Promise<void> => {
	const boss = queueBossGet(queue);
	const slots = queueSlotsGet(queue);
	for (const schedule of schedules) {
		if (scheduleOverride(env, schedule.name) === "off") {
			continue;
		}
		const held = await boss.getSchedules(schedule.name);
		if (held.length === 0) {
			logger.warn(
				{ schedule: schedule.name },
				"Schedule is not in the database, so it will not run: run migrate",
			);
			continue;
		}
		await boss.work(schedule.name, async (jobs) => {
			for (const job of jobs) {
				// A run counts toward the process's `concurrency`, like an Event.
				await slots.run(job.signal, () =>
					queueJobRun({ queueName: schedule.name, job, work: schedule.run }),
				);
			}
		});
	}
};
