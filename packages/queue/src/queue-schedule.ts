import type { Result } from "@n8io/baseline-result";
import { type Queue, queueBossGet } from "./queue.ts";
import { queueJobRun } from "./queue-job-run.ts";
import { queueWithDeadLetterCreate } from "./queue-retry.ts";

export type Schedule = {
	readonly name: string;
	readonly cron: string;
	readonly run: () => Promise<Result<unknown, { type: string }>>;
};

// name is `<domain>.<use case words, kebab>` (foo.stale-archive); cron is UTC, minute precision.
export const queueScheduleCreate = (
	name: string,
	cron: string,
	run: () => Promise<Result<unknown, { type: string }>>,
): Schedule => ({ cron, name, run });

// foo.stale-archive → SCHEDULE_FOO_STALE_ARCHIVE
export const queueScheduleEnvName = (name: string): string =>
	`SCHEDULE_${name.toUpperCase().replaceAll(/[.-]/g, "_")}`;

// Registers each schedule (worker process only) and unschedules any pg-boss holds that is no longer
// in code or is turned `off`. Every override is validated before anything registers.
export const queueSchedulesRegister = async (
	queue: Queue,
	schedules: Schedule[],
	// env is the composition root's ENV (or any object): an undeclared or non-string item means no override.
	options: { env: object },
): Promise<void> => {
	const boss = queueBossGet(queue);
	const active: { schedule: Schedule; cron: string }[] = [];
	for (const schedule of schedules) {
		const variable = queueScheduleEnvName(schedule.name);
		const value: unknown = Reflect.get(options.env, variable);
		const override = typeof value === "string" ? value : undefined;
		if (override === "off") {
			continue;
		}
		const cron = override ?? schedule.cron;
		try {
			boss.previewSchedule(cron, { count: 1, from: new Date() });
		} catch (error) {
			const source =
				override === undefined ? `schedule ${schedule.name}` : variable;
			throw new TypeError(
				`Invalid cron for ${source}: use a cron string or off`,
				{ cause: error },
			);
		}
		active.push({ cron, schedule });
	}
	for (const { cron, schedule } of active) {
		// exclusive: one job queued or active, so a tick while a run is active is skipped.
		await queueWithDeadLetterCreate(boss, schedule.name, {
			policy: "exclusive",
		});
		await boss.schedule(schedule.name, cron, null, {
			missed: "once",
			tz: "UTC",
		});
		await boss.work(schedule.name, async (jobs) => {
			for (const job of jobs) {
				await queueJobRun(schedule.name, job, schedule.run);
			}
		});
	}
	const names = new Set(active.map(({ schedule }) => schedule.name));
	for (const held of await boss.getSchedules()) {
		if (!names.has(held.name) && !held.name.startsWith("queue.")) {
			await boss.unschedule(held.name, held.key);
		}
	}
};
