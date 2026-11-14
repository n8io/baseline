import type { Inbox } from "@n8io/baseline-queue";
import { queueEventsMemoryCreate } from "@n8io/baseline-queue";
import { ok, type Result } from "@n8io/baseline-result";
import { transactionPortsGuard } from "../../../transaction-ports-guard.ts";
import type { FooEventMap } from "../models/foo.ts";
import type { FooTransaction, FooTransactionPorts } from "../ports.ts";
import {
	type FooMemoryState,
	fooRepositoryMemoryCreate,
} from "./foo-repository.memory.ts";

// Runs the work on a copy of the committed foos and swaps it in on ok; drops it on err or a
// throw. One transaction at a time.
export const fooTransactionMemoryCreate = (
	state: FooMemoryState,
): FooTransaction => {
	let tail: Promise<unknown> = Promise.resolve();

	const run = async <E>(
		work: (ports: FooTransactionPorts) => Promise<Result<unknown, E>>,
		// piece-start: queue
		inbox?: Inbox | null,
		// piece-end: queue
	): Promise<Result<unknown, E>> => {
		// piece-start: queue
		// An inbox seen before skips the work and returns ok; events reach state.published on commit.
		const inboxKey = inbox
			? JSON.stringify([inbox.consumer, inbox.eventId])
			: undefined;
		if (inboxKey !== undefined && state.inbox.has(inboxKey)) {
			return ok(undefined);
		}
		const pending: FooMemoryState["published"] = [];
		// piece-end: queue
		const scratch = { foos: structuredClone(state.foos) };
		let open = true;
		try {
			const result = await work({
				// piece-start: queue
				fooEvents: transactionPortsGuard(
					queueEventsMemoryCreate<FooEventMap>({ published: pending }),
					() => open,
				),
				// piece-end: queue
				fooRepository: transactionPortsGuard(
					fooRepositoryMemoryCreate(scratch),
					() => open,
				),
			});
			if (result.ok) {
				state.foos = scratch.foos;
				// piece-start: queue
				if (inboxKey !== undefined) state.inbox.add(inboxKey);
				state.published.push(...pending);
				// piece-end: queue
			}
			return result;
		} finally {
			open = false;
		}
	};

	return ((...args: Parameters<typeof run>) => {
		const result = tail.then(() => run(...args));
		tail = result.catch(() => undefined);
		return result;
	}) as FooTransaction;
};
