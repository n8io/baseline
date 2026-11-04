import { PgBoss, TestClock } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import { queueMigrate } from "../src/index.ts";
import { queueWithDeadLetterCreate } from "../src/queue-retry.ts";

// pg-boss's TestClock needs a db adapter that runs session statements on every connection, which
// the pgPool adapter does not; these proofs drive pg-boss directly with the settings
// schedulesRegister uses (exclusive policy, missed: "once", UTC).
//
// pg-boss runs a cron pass as it starts, and that pass sends any occurrence from the last 60 s
// (its due window). scheduleRegister writes the schedule row before a start, so that pass always
// sees it; registering after start raced the pass and sent that occurrence by timing.

const name = "foo.stale-archive";
let databaseUrl: string;
const bosses: PgBoss[] = [];

const bossStart = async (
	clock: TestClock,
	options: { schedule?: boolean } = {},
): Promise<PgBoss> => {
	const boss = new PgBoss({
		clock,
		connectionString: databaseUrl,
		max: 3,
		migrate: false,
		schema: "queue",
		...options,
	});
	boss.on("error", () => undefined);
	bosses.push(boss);
	await boss.start();
	return boss;
};

// Writes the queue and the schedule row through a boss that runs no cron pass.
const scheduleRegister = async (
	clock: TestClock,
	cron: string,
): Promise<void> => {
	const boss = await bossStart(clock, { schedule: false });
	await queueWithDeadLetterCreate(boss, name, { policy: "exclusive" });
	await boss.schedule(name, cron, null, { missed: "once", tz: "UTC" });
	await boss.stop({ graceful: false });
	bosses.splice(bosses.indexOf(boss), 1);
};

const jobs = async (boss: PgBoss): Promise<string[]> =>
	(await boss.findJobs(name)).map((job) => job.state);

beforeEach(async () => {
	databaseUrl = await postgresTestDatabaseCreate();
	await queueMigrate({ databaseUrl });
});

afterEach(async () => {
	for (const boss of bosses.splice(0)) {
		await boss.stop({ graceful: false });
	}
});

describe("schedule settings under pg-boss's TestClock", () => {
	it("the exclusive policy skips a tick while a run is active", async () => {
		const clock = new TestClock(new Date("2026-11-03T00:00:30Z"));
		await scheduleRegister(clock, "* * * * *");
		const boss = await bossStart(clock);
		let release = (): void => undefined;
		let runs = 0;
		await boss.work(name, async () => {
			runs += 1;
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		});

		for (let minute = 0; minute < 4; minute += 1) {
			await clock.tick(60_000);
		}
		// One run is active; the ticks that came due while it ran created no job.
		expect(runs).toBe(1);
		expect(await jobs(boss)).toEqual(["active"]);

		release();
		for (let minute = 0; minute < 2; minute += 1) {
			await clock.tick(60_000);
		}
		expect(runs).toBe(2);
	});

	// Every ten minutes, and every start at hh:m5:30, so a start's due window holds no occurrence:
	// a run after the downtime can only be the catch-up (with missed: "skip" there is none).
	it("after downtime, missed: once sends one catch-up job", async () => {
		const clock = new TestClock(new Date("2026-11-03T00:05:30Z"));
		const runAt: string[] = [];
		const run = async (): Promise<void> => {
			runAt.push(new Date(clock.now()).toISOString());
		};
		await scheduleRegister(clock, "*/10 * * * *");
		const first = await bossStart(clock);
		await first.work(name, run);
		await clock.tick(5 * 60_000);
		expect(runAt).toEqual(["2026-11-03T00:10:00.000Z"]);
		await first.stop({ graceful: false });
		bosses.splice(bosses.indexOf(first), 1);

		// Down for 55 minutes: 00:20 to 01:00 missed. Back up at 01:05:30.
		await clock.setTime(new Date("2026-11-03T01:05:30Z"));
		const second = await bossStart(clock);
		await second.work(name, run);
		await clock.tick(25_000);
		expect(runAt).toHaveLength(2);
		expect(runAt[1]?.startsWith("2026-11-03T01:05:")).toBe(true);

		// Then the schedule carries on at the next occurrence.
		await clock.tick(4 * 60_000 + 10_000);
		expect(runAt.at(-1)).toBe("2026-11-03T01:10:00.000Z");
		expect(runAt).toHaveLength(3);
	});
});
