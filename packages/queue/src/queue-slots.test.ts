import { describe, expect, it } from "vitest";
import type { Queue } from "./queue.ts";
import { queueSlotsGet } from "./queue-slots.ts";

// A Queue that queueCreate did not make has the default concurrency: 4.
const slotsOfFour = () => queueSlotsGet({} as Queue);

// A job that runs until `end` is called.
const jobCreate = (started: string[], name: string) => {
	const { promise, resolve } = Promise.withResolvers<void>();
	return {
		end: resolve,
		work: async () => {
			started.push(name);
			await promise;
		},
	};
};

const never = new AbortController().signal;
const turn = (): Promise<void> =>
	new Promise((resolve) => setImmediate(resolve));

describe("queueSlotsGet", () => {
	it("gives one Queue the same slots every time", () => {
		const queue = {} as Queue;

		expect(queueSlotsGet(queue)).toBe(queueSlotsGet(queue));
		expect(queueSlotsGet(queue)).not.toBe(slotsOfFour());
	});

	it("runs as many jobs at once as the concurrency, and the rest in the order they came", async () => {
		const slots = slotsOfFour();
		const started: string[] = [];
		const jobs = ["a", "b", "c", "d", "e", "f"].map((name) =>
			jobCreate(started, name),
		);
		const runs = jobs.map((job) => slots.run(never, job.work));
		await turn();
		expect(started).toEqual(["a", "b", "c", "d"]);

		jobs[2]?.end();
		await turn();
		expect(started).toEqual(["a", "b", "c", "d", "e"]);

		for (const job of jobs) job.end();
		expect(await Promise.all(runs)).toEqual(Array(6).fill(true));
		expect(started).toEqual(["a", "b", "c", "d", "e", "f"]);
	});

	it("gives the slot back when the job throws", async () => {
		const slots = slotsOfFour();
		const started: string[] = [];
		for (const name of ["a", "b", "c", "d"]) {
			await expect(
				slots.run(never, async () => {
					throw new Error(name);
				}),
			).rejects.toThrow(name);
		}

		const job = jobCreate(started, "e");
		const run = slots.run(never, job.work);
		await turn();
		expect(started).toEqual(["e"]);
		job.end();
		await run;
	});

	it("does not run a job that was given up before a slot came free", async () => {
		const slots = slotsOfFour();
		const started: string[] = [];
		const running = ["a", "b", "c", "d"].map((name) =>
			jobCreate(started, name),
		);
		const runs = running.map((job) => slots.run(never, job.work));
		const givenUp = new AbortController();
		const waiting = slots.run(givenUp.signal, jobCreate(started, "e").work);
		const next = jobCreate(started, "f");
		const after = slots.run(never, next.work);
		await turn();

		givenUp.abort();
		expect(await waiting).toBe(false);
		running[0]?.end();
		await turn();

		// The slot went to the next in line, not to the job that left.
		expect(started).toEqual(["a", "b", "c", "d", "f"]);
		const aborted = AbortSignal.abort();
		expect(await slots.run(aborted, jobCreate(started, "g").work)).toBe(false);
		for (const job of [...running, next]) job.end();
		await Promise.all([...runs, after]);
		expect(started).not.toContain("e");
		expect(started).not.toContain("g");
	});

	it("takes the slot back from a job that hangs once it is given up", async () => {
		const slots = slotsOfFour();
		const started: string[] = [];
		const givenUp = new AbortController();
		// Four jobs that never end, as a Consumer whose call never returns.
		for (const name of ["a", "b", "c", "d"]) {
			void slots.run(givenUp.signal, jobCreate(started, name).work);
		}
		const waiting = ["e", "f", "g", "h", "i"].map((name) =>
			jobCreate(started, name),
		);
		const runs = waiting.map((job) => slots.run(never, job.work));
		await turn();
		expect(started).toEqual(["a", "b", "c", "d"]);

		givenUp.abort();
		await turn();

		// Four slots came back, no more: the fifth still waits.
		expect(started).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
		for (const job of waiting) job.end();
		expect(await Promise.all(runs)).toEqual(Array(5).fill(true));
	});
});
