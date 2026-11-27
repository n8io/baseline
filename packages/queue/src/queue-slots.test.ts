import { getEventListeners } from "node:events";
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

	it("gives a slot back once when a job ends after it was given up", async () => {
		const slots = slotsOfFour();
		const started: string[] = [];
		const givenUp = new AbortController();
		const hung = ["a", "b", "c", "d"].map((name) => jobCreate(started, name));
		const hungRuns = hung.map((job) => slots.run(givenUp.signal, job.work));
		await turn();

		givenUp.abort();
		for (const job of hung) job.end();
		await Promise.all(hungRuns);
		const next = ["e", "f", "g", "h", "i"].map((name) =>
			jobCreate(started, name),
		);
		const runs = next.map((job) => slots.run(never, job.work));
		await turn();

		// Four slots, not five: each job gave its slot back once.
		expect(started).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
		for (const job of next) job.end();
		await Promise.all(runs);
	});

	it("leaves no abort listener on the signal, whether the job ends or is given up", async () => {
		const slots = slotsOfFour();
		const started: string[] = [];
		const signal = new AbortController();
		const job = jobCreate(started, "a");
		const run = slots.run(signal.signal, job.work);
		await turn();
		expect(getEventListeners(signal.signal, "abort")).toHaveLength(1);

		job.end();
		await run;
		expect(getEventListeners(signal.signal, "abort")).toHaveLength(0);

		// A job given up while it runs: its listener goes at the abort, not only when the job ends.
		const given = new AbortController();
		const hung = jobCreate(started, "b");
		const hungRun = slots.run(given.signal, hung.work);
		await turn();
		given.abort();
		expect(getEventListeners(given.signal, "abort")).toHaveLength(0);
		hung.end();
		await hungRun;

		// A job given up while it waits for a slot.
		const full = ["c", "d", "e", "f"].map((name) => jobCreate(started, name));
		const fullRuns = full.map((one) => slots.run(never, one.work));
		const waitingSignal = new AbortController();
		const waiting = slots.run(
			waitingSignal.signal,
			jobCreate(started, "g").work,
		);
		await turn();
		expect(getEventListeners(waitingSignal.signal, "abort")).toHaveLength(1);
		waitingSignal.abort();
		expect(getEventListeners(waitingSignal.signal, "abort")).toHaveLength(0);
		expect(await waiting).toBe(false);

		// A job that waited and got its slot leaves none either.
		const late = new AbortController();
		const lateJob = jobCreate(started, "h");
		const lateRun = slots.run(late.signal, lateJob.work);
		await turn();
		expect(getEventListeners(late.signal, "abort")).toHaveLength(1);
		full[0]?.end();
		await turn();
		expect(getEventListeners(late.signal, "abort")).toHaveLength(1);
		lateJob.end();
		await lateRun;
		expect(getEventListeners(late.signal, "abort")).toHaveLength(0);
		for (const one of full) one.end();
		await Promise.all(fullRuns);
	});
});
