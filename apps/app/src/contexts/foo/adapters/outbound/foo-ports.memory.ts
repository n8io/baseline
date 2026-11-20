import { cacheStoreMemoryCreate } from "@n8io/baseline-cache";
import { type ClockMemory, clockMemoryCreate } from "../../../../clock.ts";
import type { FooPorts } from "../../application/ports.ts";
import { barRepositoryMemoryCreate } from "./bar-repository.memory.ts";
import { fooCacheCreate } from "./foo-cached.ts";
import { fooRepositoryMemoryCreate } from "./foo-repository.memory.ts";
import {
	fooMemoryStateCreate,
	fooTransactionMemoryCreate,
} from "./foo-transaction.memory.ts";

// Every port of the context in memory, plus the state they share: committed rows and, with the
// queue, committed events. The clock stands still until the test moves it. A context test builds
// the context through contextsCreate instead; this is for the repository suites and race tests.
export const fooPortsMemoryCreate = () => {
	const clock: ClockMemory = clockMemoryCreate();
	const state = fooMemoryStateCreate();
	const ports: FooPorts = {
		// piece-start: analytics
		fooAnalytics: { track: () => undefined },
		// piece-end: analytics
		// piece-start: cache
		fooCache: fooCacheCreate(cacheStoreMemoryCreate()),
		// piece-end: cache
		// piece-start: live
		fooLiveUpdates: { send: async () => undefined },
		// piece-end: live
		barReadRepository: barRepositoryMemoryCreate(state),
		fooReadRepository: fooRepositoryMemoryCreate(state),
		// wiring: ports
		fooClock: clock,
		fooTransaction: fooTransactionMemoryCreate(state),
	};
	return { clock, ports, state };
};
