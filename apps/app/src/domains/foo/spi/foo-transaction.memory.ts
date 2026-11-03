import type { Inbox } from "@n8io/baseline-queue";
import { queueEventsMemory } from "@n8io/baseline-queue";
import { ok, type Result } from "@n8io/baseline-result";
import type { FooEventMap } from "../models/foo.ts";
import type { FooTransaction, FooTransactionPorts } from "../ports.ts";
import {
	type FooMemoryState,
	fooRepositoryMemory,
} from "./foo-repository.memory.ts";

export type FooPublished = { name: keyof FooEventMap; data: unknown };

// Ports that throw once their transaction has ended, like the Postgres client guard.
const fooPortsGuard = <T extends object>(ports: T, isOpen: () => boolean): T =>
	Object.fromEntries(
		Object.entries(ports).map(([key, value]) => [
			key,
			typeof value === "function"
				? async (...args: unknown[]) => {
						if (!isOpen()) {
							throw new Error(
								"Foo transaction ports used after the transaction ended; keep every call inside the callback",
							);
						}
						return value(...args);
					}
				: value,
		]),
	) as T;

// Runs the work on a copy of the committed foos and swaps it in on ok; drops it on err or a
// throw. One transaction at a time. Events reach `published` only on commit; an inbox seen
// before skips the work and returns ok.
export const fooTransactionMemory = (
	state: FooMemoryState,
	published: FooPublished[] = [],
): FooTransaction => {
	let tail: Promise<unknown> = Promise.resolve();

	const run = async <E>(
		work: (ports: FooTransactionPorts) => Promise<Result<unknown, E>>,
		inbox?: Inbox,
	): Promise<Result<unknown, E>> => {
		const inboxKey = inbox && JSON.stringify([inbox.consumer, inbox.eventId]);
		if (inboxKey !== undefined && state.inbox.has(inboxKey)) {
			return ok(undefined);
		}
		const scratch = { foos: structuredClone(state.foos) };
		const pending: FooPublished[] = [];
		let open = true;
		try {
			const result = await work({
				fooEvents: fooPortsGuard(
					queueEventsMemory<FooEventMap>(pending),
					() => open,
				),
				fooRepository: fooPortsGuard(fooRepositoryMemory(scratch), () => open),
			});
			if (result.ok) {
				state.foos = scratch.foos;
				if (inboxKey !== undefined) state.inbox.add(inboxKey);
				published.push(...pending);
			}
			return result;
		} finally {
			open = false;
		}
	};

	return ((work, inbox) => {
		const result = tail.then(() => run(work, inbox));
		tail = result.catch(() => undefined);
		return result;
	}) as FooTransaction;
};
