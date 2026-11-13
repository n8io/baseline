import { type Queue, queueConcurrencyGet } from "./queue.ts";

// Lets a fixed number of jobs run at once in one worker process and makes the rest wait their
// turn, first come first served. Every Consumer and Schedule of the process shares it, so their
// jobs together never hold more pool connections than `concurrency` allows.
export type QueueSlots = {
	// Runs `work` once a slot is free and resolves true. Resolves false without running it when
	// `signal` aborts first (pg-boss has given the job up). A job whose signal aborts while it
	// runs gives its slot back at once, so a job that hangs cannot hold a slot for good.
	run(signal: AbortSignal, work: () => Promise<void>): Promise<boolean>;
};

const slotsCreate = (size: number): QueueSlots => {
	let free = size;
	const waiting: (() => void)[] = [];
	const give = (): void => {
		const next = waiting.shift();
		if (next) {
			next();
		} else {
			free++;
		}
	};
	const take = (signal: AbortSignal): Promise<boolean> => {
		if (signal.aborted) {
			return Promise.resolve(false);
		}
		if (free > 0) {
			free--;
			return Promise.resolve(true);
		}
		return new Promise((resolve) => {
			const grant = (): void => {
				signal.removeEventListener("abort", leave);
				resolve(true);
			};
			const leave = (): void => {
				waiting.splice(waiting.indexOf(grant), 1);
				resolve(false);
			};
			waiting.push(grant);
			signal.addEventListener("abort", leave, { once: true });
		});
	};
	return {
		run: async (signal, work) => {
			if (!(await take(signal))) {
				return false;
			}
			let held = true;
			const release = (): void => {
				if (held) {
					held = false;
					give();
				}
			};
			signal.addEventListener("abort", release, { once: true });
			try {
				await work();
			} finally {
				signal.removeEventListener("abort", release);
				release();
			}
			return true;
		},
	};
};

const queueSlots = new WeakMap<Queue, QueueSlots>();

// The one set of slots of a Queue's process, sized by its `concurrency`.
export const queueSlotsGet = (queue: Queue): QueueSlots => {
	const slots =
		queueSlots.get(queue) ?? slotsCreate(queueConcurrencyGet(queue));
	queueSlots.set(queue, slots);
	return slots;
};
