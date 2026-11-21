import { logger } from "@n8io/baseline-logger";
import type { Result } from "@n8io/baseline-result";
import { PgBoss } from "pg-boss";
import {
	type Queue,
	queueBossGet,
	queueErrorWrap,
	queueSchema,
} from "./queue.ts";
import { queueConnectionAssert } from "./queue-connection-assert.ts";
import { queueJobRun } from "./queue-job-run.ts";
import type { QueueMigrateVendorOptions } from "./queue-migrate.ts";
import { queueSlotsGet } from "./queue-slots.ts";
import { queueWithDeadLetterCreate } from "./queue-with-dead-letter.ts";

/** A UTC cron Schedule, made by `queueScheduleCreate`. */
export type Schedule = {
	readonly name: string;
	readonly cron: string;
	readonly run: () => Promise<Result<unknown, { type: string }>>;
};

/** What `queueScheduleCreate` takes: the Schedule's own fields. */
export type QueueScheduleOptions = {
	/** UTC, minute precision. */
	cron: string;
	/** `<context>.<use-case-words>` (foo.stale-archive). */
	name: string;
	/** What one tick runs; an err Result fails the job. */
	run: () => Promise<Result<unknown, { type: string }>>;
};

/** A Schedule. name is `<context>.<use-case-words>`; cron is UTC, minute precision. */
export const queueScheduleCreate = ({
	cron,
	name,
	run,
}: QueueScheduleOptions): Schedule => ({ cron, name, run });

/** foo.stale-archive → SCHEDULE_FOO_STALE_ARCHIVE. Not exported from the Package. */
export const queueScheduleEnvName = (name: string): string =>
	`SCHEDULE_${name.toUpperCase().replaceAll(/[.-]/g, "_")}`;

// A Schedule's override in the composition root's ENV (or any object): a cron, or `off`. An
// undeclared or non-string item means none.
const scheduleOverride = (env: object, name: string): string | undefined => {
	const value: unknown = Reflect.get(env, queueScheduleEnvName(name));
	return typeof value === "string" ? value : undefined;
};

/** Settings only pg-boss's own connection has: the same ones `queueMigrate` takes. */
export type QueueSchedulesSyncVendorOptions = QueueMigrateVendorOptions;

/** What `queueSchedulesSync` takes. */
export type QueueSchedulesSyncOptions = {
	/** The Postgres URL, `postgres://` or `postgresql://`. */
	databaseUrl: string;
	/** The composition root's ENV: `SCHEDULE_<NAME>` overrides a cron, or turns the Schedule `off`. */
	env: object;
	/** The Schedules in code: each one's name and cron. */
	schedules: readonly Pick<Schedule, "cron" | "name">[];
	/** Settings only pg-boss's own connection has, such as `ssl`: the same ones queueMigrate takes. */
	vendor?: QueueSchedulesSyncVendorOptions | null;
};

/**
 * Makes the Schedules the database holds match the ones in code: adds each, updates its cron, and
 * removes any that is no longer listed or is turned `off`. Every cron is validated before anything
 * changes. Runs from the migrate entry, after queueMigrate, so once per rollout and with the newest
 * code: a Worker of the previous version that boots mid-rollout changes nothing. Throws a
 * TypeError at the call on a `databaseUrl` that is not a Postgres URL, a `vendor` key other than
 * `ssl`, `application_name` and `options`, or a cron (in `schedules` or an `env` override) that is
 * not valid.
 */
export const queueSchedulesSync = async (
	options: QueueSchedulesSyncOptions,
): Promise<void> => {
	const { databaseUrl, env, schedules } = options;
	const vendor = options.vendor ?? {};
	queueConnectionAssert({ caller: "queueSchedulesSync", databaseUrl, vendor });
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
						? `schedules: invalid cron for ${name}`
						: `env.${queueScheduleEnvName(name)}: invalid cron`;
				throw new TypeError(
					`queueSchedulesSync: ${source}; use a cron string or off`,
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
			// The `queue.` namespace is the Package's own (inbox pruning).
			if (!names.has(held.name) && !held.name.startsWith("queue.")) {
				await boss.unschedule(held.name, held.key);
			}
		}
	} finally {
		await boss.stop({ graceful: true, timeout: 15_000 });
	}
};

/** What `queueSchedulesStart` takes. */
export type QueueSchedulesStartOptions = {
	/** The composition root's ENV, for the `off` overrides. */
	env: object;
	/** The Worker's queue, from `queueCreate`. */
	queue: Queue;
	/** The Schedules to run. */
	schedules: readonly Schedule[];
};

/**
 * Starts running each Schedule (Worker process only). It changes nothing in the database: a
 * Schedule that queueSchedulesSync has not added there is not started, with a warning, since it
 * would never fire. One turned `off` is skipped silently. The cron overrides are not read here:
 * they act where queueSchedulesSync runs.
 */
export const queueSchedulesStart = async ({
	env,
	queue,
	schedules,
}: QueueSchedulesStartOptions): Promise<void> => {
	const boss = queueBossGet(queue, "queueSchedulesStart");
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
