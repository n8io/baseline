import { describe, expect, it } from "vitest";
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
});
