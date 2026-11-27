import { describe, expect, it } from "vitest";
import { queueLoggerTestRecord } from "./queue-logger-test-record.ts";
import {
	type QueueMigrateIndexesBoss,
	queueMigrateIndexesWait,
} from "./queue-migrate-indexes-wait.ts";

// A plain stand-in for the two pg-boss reads, which answers from a list of statuses.
const bossCreate = (
	statuses: readonly ("pending" | "in_progress" | "completed" | "failed")[],
): QueueMigrateIndexesBoss & { polls: () => number } => {
	let polls = 0;
	return {
		getBamStatus: async () => {
			const status =
				statuses[Math.min(polls, statuses.length - 1)] ?? "completed";
			polls += 1;
			return [{ count: 1, lastCreatedOn: new Date(0), status }];
		},
		isBamWorking: () => false,
		polls: () => polls,
	};
};

describe("queueMigrateIndexesWait", () => {
	it("returns once the builds are done", async () => {
		const boss = bossCreate(["pending", "in_progress", "completed"]);

		await queueMigrateIndexesWait({
			boss,
			deadlineMs: 5000,
			pollMs: 5,
			startMs: 0,
		});

		expect(boss.polls()).toBe(3);
	});

	it("throws, starting with the function name, when the builds stay busy past the deadline", async () => {
		const boss = bossCreate(["in_progress"]);

		await expect(
			queueMigrateIndexesWait({
				boss,
				deadlineMs: 50,
				pollMs: 10,
				startMs: 0,
			}),
		).rejects.toThrow(
			new Error("queueMigrate: index builds still running after 50 ms"),
		);
		expect(boss.polls()).toBeGreaterThan(1);
	});

	it.each([{}, { deadlineMs: null }])(
		"waits without limit when the deadline is unset: %o",
		async (deadline) => {
			const boss = bossCreate([
				...Array.from({ length: 30 }, () => "in_progress" as const),
				"completed",
			]);

			await queueMigrateIndexesWait({
				boss,
				pollMs: 5,
				startMs: 0,
				...deadline,
			});

			expect(boss.polls()).toBe(31);
		},
	);

	it("keeps waiting while any build is busy, whatever the others are", async () => {
		let polls = 0;
		const boss: QueueMigrateIndexesBoss = {
			getBamStatus: async () => {
				polls += 1;
				const second = polls < 3 ? "in_progress" : "completed";
				return [
					{ count: 1, lastCreatedOn: new Date(0), status: "completed" },
					{ count: 1, lastCreatedOn: new Date(0), status: second },
				];
			},
			isBamWorking: () => false,
		};

		await queueMigrateIndexesWait({ boss, pollMs: 1, startMs: 0 });

		expect(polls).toBe(3);
	});

	it("keeps waiting while pg-boss is working, even when no build is listed busy", async () => {
		let polls = 0;
		const boss: QueueMigrateIndexesBoss = {
			getBamStatus: async () => {
				polls += 1;
				return [];
			},
			isBamWorking: () => polls < 3,
		};

		await queueMigrateIndexesWait({ boss, pollMs: 1, startMs: 0 });

		expect(polls).toBe(3);
	});

	it("warns with the count of failed builds, and goes on", async () => {
		using warn = queueLoggerTestRecord("warn");
		const boss: QueueMigrateIndexesBoss = {
			getBamStatus: async () => [
				{ count: 1, lastCreatedOn: new Date(0), status: "completed" },
				{ count: 3, lastCreatedOn: new Date(0), status: "failed" },
			],
			isBamWorking: () => false,
		};

		await queueMigrateIndexesWait({ boss, pollMs: 1, startMs: 0 });

		expect(warn.calls).toEqual([
			[
				{ queueIndexBuildsFailed: 3 },
				"Queue index builds failed; the next migrate retries them",
			],
		]);
	});

	it("does not warn when no build failed", async () => {
		using warn = queueLoggerTestRecord("warn");

		await queueMigrateIndexesWait({
			boss: bossCreate(["completed"]),
			pollMs: 1,
			startMs: 0,
		});

		expect(warn.calls).toEqual([]);
	});

	it("waits 100 ms before the first poll unless told otherwise", async () => {
		const boss = bossCreate(["completed"]);
		const started = Date.now();

		await queueMigrateIndexesWait({ boss });

		expect(Date.now() - started).toBeGreaterThanOrEqual(90);
		expect(boss.polls()).toBe(1);
	});

	it("polls every second unless told otherwise", async () => {
		const boss = bossCreate(["in_progress", "completed"]);
		const started = Date.now();

		await queueMigrateIndexesWait({ boss, startMs: 0 });

		expect(Date.now() - started).toBeGreaterThanOrEqual(900);
	});
});
