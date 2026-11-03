import { PgBoss, TestClock } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { queueMigrate } from "../src/index.ts";
import { queueWithDeadLetterCreate } from "../src/queue-retry.ts";
import { queueTestDatabaseCreate } from "./queue-test-database.ts";

// pg-boss's TestClock needs a db adapter that runs session statements on every connection, which
// the pgPool adapter does not; these proofs drive pg-boss directly with the settings
// schedulesRegister uses (exclusive policy, missed: "once", UTC).

const name = "foo.stale-archive";
const start = new Date("2026-11-03T00:00:30Z");
let databaseUrl: string;
const bosses: PgBoss[] = [];

const bossStart = async (clock: TestClock): Promise<PgBoss> => {
	const boss = new PgBoss({
		clock,
		connectionString: databaseUrl,
		max: 3,
		migrate: false,
		schema: "queue",
	});
	boss.on("error", () => undefined);
	bosses.push(boss);
	await boss.start();
	await queueWithDeadLetterCreate(boss, name, { policy: "exclusive" });
	await boss.schedule(name, "* * * * *", null, { missed: "once", tz: "UTC" });
	return boss;
};

const jobs = async (boss: PgBoss): Promise<string[]> =>
	(await boss.findJobs(name)).map((job) => job.state);

beforeEach(async () => {
	databaseUrl = await queueTestDatabaseCreate();
	await queueMigrate({ databaseUrl });
});

afterEach(async () => {
	for (const boss of bosses.splice(0)) {
		await boss.stop({ graceful: false });
	}
});

describe("schedule settings under pg-boss's TestClock", () => {
	it("V11: the exclusive policy skips a tick while a run is active", async () => {
		const clock = new TestClock(start);
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

	it("V12: after downtime, missed: once sends one catch-up job", async () => {
		const clock = new TestClock(start);
		const runAt: string[] = [];
		const run = async (): Promise<void> => {
			runAt.push(new Date(clock.now()).toISOString());
		};
		const first = await bossStart(clock);
		await first.work(name, run);
		await clock.tick(60_000);
		expect(runAt).toEqual(["2026-11-03T00:01:00.000Z"]);
		await first.stop({ graceful: false });
		bosses.splice(bosses.indexOf(first), 1);

		// Down for an hour: sixty ticks missed. Back up at 01:01:30.
		await clock.setTime(new Date(clock.now() + 60 * 60_000));
		const second = await bossStart(clock);
		await second.work(name, run);
		await clock.tick(25_000);
		expect(runAt).toHaveLength(2);
		expect(runAt[1]?.startsWith("2026-11-03T01:01:")).toBe(true);

		// Then the schedule carries on at the next minute.
		await clock.tick(10_000);
		expect(runAt.at(-1)).toBe("2026-11-03T01:02:00.000Z");
		expect(runAt).toHaveLength(3);
	});
});
