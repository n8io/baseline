import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Queue } from "./queue.ts";
import { queueSlotsGet } from "./queue-slots.ts";

const never = new AbortController().signal;

// Runs `count` jobs through slots of the default size (4); each ends when `finishOrder` says.
// Returns the order the jobs started in and the most that ran at once.
const jobsRun = async (
	count: number,
	finishOrder: readonly number[],
): Promise<{ peak: number; started: number[] }> => {
	const slots = queueSlotsGet({} as Queue);
	const started: number[] = [];
	const ends: (() => void)[] = [];
	let running = 0;
	let peak = 0;
	const runs = Array.from({ length: count }, (_unused, index) => {
		const { promise, resolve } = Promise.withResolvers<void>();
		ends[index] = resolve;
		return slots.run(never, async () => {
			started.push(index);
			running++;
			peak = Math.max(peak, running);
			await promise;
			running--;
		});
	});
	const turn = (): Promise<void> =>
		new Promise((resolve) => setImmediate(resolve));
	await turn();
	// Finish the jobs in the given order, but only those that have started.
	for (const wanted of finishOrder) {
		const next = started.includes(wanted) ? wanted : started.at(-1);
		if (next !== undefined) ends[next]?.();
		await turn();
	}
	for (const end of ends) end();
	await Promise.all(runs);
	return { peak, started };
};

describe("queueSlotsGet properties", () => {
	it("never runs more than the concurrency, and starts jobs in the order they came", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({ max: 12, min: 1 }),
				fc.array(fc.integer({ max: 11, min: 0 }), { maxLength: 12 }),
				async (count, finishOrder) => {
					const { peak, started } = await jobsRun(count, finishOrder);

					expect(peak).toBeLessThanOrEqual(4);
					expect(started).toEqual(Array.from({ length: count }, (_u, i) => i));
				},
			),
			{ numRuns: 50 },
		);
	});
});
