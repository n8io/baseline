import type { FooLiveUpdates, FooPorts } from "../ports.ts";
import { fooCacheMemoryCreate } from "./foo-cache.memory.ts";
import {
	type FooMemoryState,
	fooMemoryStateCreate,
	fooRepositoryMemoryCreate,
} from "./foo-repository.memory.ts";
import {
	type FooPublished,
	fooTransactionMemoryCreate,
} from "./foo-transaction.memory.ts";

// piece-start: live
export type FooLiveUpdate = Parameters<FooLiveUpdates["send"]>[0];
// piece-end: live

// Every foo port in memory, plus what they recorded: committed events and sent live updates.
export const fooPortsMemoryCreate = (): {
	ports: FooPorts;
	// piece-start: queue
	published: FooPublished[];
	// piece-end: queue
	// piece-start: live
	sent: FooLiveUpdate[];
	// piece-end: live
	state: FooMemoryState;
} => {
	const state = fooMemoryStateCreate();
	// piece-start: queue
	const published: FooPublished[] = [];
	// piece-end: queue
	// piece-start: live
	const sent: FooLiveUpdate[] = [];
	// piece-end: live
	return {
		ports: {
			// piece-start: cache
			fooCache: fooCacheMemoryCreate(),
			// piece-end: cache
			// piece-start: live
			fooLiveUpdates: {
				send: async (update) => {
					sent.push(update);
				},
			},
			// piece-end: live
			fooReadRepository: fooRepositoryMemoryCreate(state),
			fooTransaction: fooTransactionMemoryCreate(
				state,
				// piece-start: queue
				published,
				// piece-end: queue
			),
		},
		// piece-start: queue
		published,
		// piece-end: queue
		// piece-start: live
		sent,
		// piece-end: live
		state,
	};
};
