import { cacheStoreMemoryCreate } from "@n8io/baseline-cache";
import type { FooPorts } from "../ports.ts";
import { fooCacheCreate } from "./foo-cache.ts";
import {
	type FooMemoryState,
	fooMemoryStateCreate,
	fooRepositoryMemoryCreate,
} from "./foo-repository.memory.ts";
import { fooTransactionMemoryCreate } from "./foo-transaction.memory.ts";

// Every foo port in memory, plus the state they share: committed foos and, with the queue,
// committed events. Live updates and analytics events go nowhere; a test that checks them passes
// its own.
export const fooPortsMemoryCreate = (): {
	ports: FooPorts;
	state: FooMemoryState;
} => {
	const state = fooMemoryStateCreate();
	return {
		ports: {
			// piece-start: analytics
			fooAnalytics: { track: () => undefined },
			// piece-end: analytics
			// piece-start: cache
			fooCache: fooCacheCreate(cacheStoreMemoryCreate()),
			// piece-end: cache
			// piece-start: live
			fooLiveUpdates: { send: async () => undefined },
			// piece-end: live
			fooReadRepository: fooRepositoryMemoryCreate(state),
			fooTransaction: fooTransactionMemoryCreate(state),
		},
		state,
	};
};
