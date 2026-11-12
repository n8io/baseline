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
	published: FooPublished[];
	// piece-start: live
	sent: FooLiveUpdate[];
	// piece-end: live
	state: FooMemoryState;
} => {
	const state = fooMemoryStateCreate();
	const published: FooPublished[] = [];
	// piece-start: live
	const sent: FooLiveUpdate[] = [];
	// piece-end: live
	return {
		ports: {
			fooCache: fooCacheMemoryCreate(),
			// piece-start: live
			fooLiveUpdates: {
				send: async (update) => {
					sent.push(update);
				},
			},
			// piece-end: live
			fooReadRepository: fooRepositoryMemoryCreate(state),
			fooTransaction: fooTransactionMemoryCreate(state, published),
		},
		published,
		// piece-start: live
		sent,
		// piece-end: live
		state,
	};
};
