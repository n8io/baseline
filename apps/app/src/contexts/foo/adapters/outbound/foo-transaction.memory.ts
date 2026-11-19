import type { Id } from "@n8io/baseline-id";
import type { Inbox } from "@n8io/baseline-queue";
import { queueEventsMemoryCreate } from "@n8io/baseline-queue";
import { ok, type Result } from "@n8io/baseline-result";
import { transactionPortsGuard } from "../../../../transaction-ports-guard.ts";
import type {
	FooTransaction,
	FooTransactionPorts,
} from "../../application/ports.ts";
import type { Bar } from "../../domain/bar.ts";
import type { Foo } from "../../domain/foo.ts";
import { barRepositoryMemoryCreate } from "./bar-repository.memory.ts";
import { fooRepositoryMemoryCreate } from "./foo-repository.memory.ts";

// The context's committed rows, one map per Aggregate. The read repositories and the transaction
// share one state object; a transaction swaps in its copies on commit.
export type FooMemoryState = {
	bars: Map<Id<"bar">, Bar>;
	foos: Map<Id<"foo">, Foo>;
	// wiring: memory-state
	// piece-start: queue
	inbox: Set<string>;
	// Events reach it only on commit.
	published: { name: string; data: unknown; key: string }[];
	// piece-end: queue
};

export const fooMemoryStateCreate = (): FooMemoryState => ({
	bars: new Map(),
	foos: new Map(),
	// wiring: memory-state-create
	// piece-start: queue
	inbox: new Set(),
	published: [],
	// piece-end: queue
});

// Runs the work on a copy of the committed rows and swaps it in on ok; drops it on err or a
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
		const scratch = {
			bars: structuredClone(state.bars),
			foos: structuredClone(state.foos),
			// wiring: memory-scratch
		};
		let open = true;
		try {
			const result = await work({
				barRepository: transactionPortsGuard(
					barRepositoryMemoryCreate(scratch),
					() => open,
				),
				// piece-start: queue
				fooEvents: transactionPortsGuard(
					queueEventsMemoryCreate({ published: pending }),
					() => open,
				),
				// piece-end: queue
				fooRepository: transactionPortsGuard(
					fooRepositoryMemoryCreate(scratch),
					() => open,
				),
				// wiring: transaction-ports
			});
			if (result.ok) {
				Object.assign(state, scratch);
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
