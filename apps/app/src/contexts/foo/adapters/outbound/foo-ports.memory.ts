import { cacheCreate, cacheStoreMemoryCreate } from "@n8io/baseline-cache";
import { type ClockMemory, clockMemoryCreate } from "../../../../clock.ts";
import type { FooPorts } from "../../application/ports.ts";
import { barRepositoryMemoryCreate } from "./bar-repository.memory.ts";
import { fooCached } from "./foo-cached.ts";
import { fooRepositoryMemoryCreate } from "./foo-repository.memory.ts";
import {
	fooMemoryStateCreate,
	fooTransactionMemoryCreate,
} from "./foo-transaction.memory.ts";

// Every port of the context in memory, plus the state they share: committed rows and, with the
// queue, committed events. The clock stands still until the test moves it. The state also records
// what the live updates and analytics ports were given, in order, for a test to read.
export const fooPortsMemoryCreate = () => {
	const clock: ClockMemory = clockMemoryCreate();
	const state = {
		...fooMemoryStateCreate(),
		// piece-start: analytics
		// `committed`: whether the foo was already committed when the event was tracked.
		fooAnalyticsTracked: [] as (Parameters<
			FooPorts["fooAnalytics"]["track"]
		>[0] & { committed: boolean })[],
		// piece-end: analytics
		// piece-start: live
		fooLiveUpdatesSent: [] as Parameters<
			FooPorts["fooLiveUpdates"]["send"]
		>[0][],
		// piece-end: live
		// wiring: memory-records
	};
	const ports: FooPorts = {
		// piece-start: analytics
		fooAnalytics: {
			track: (event) => {
				state.fooAnalyticsTracked.push({
					...event,
					committed: state.foos.has(event.fooId),
				});
			},
		},
		// piece-end: analytics
		// piece-start: cache
		fooCache: cacheCreate(cacheStoreMemoryCreate(), {
			keyOf: (foo) => foo.id,
			prefix: "foo",
			schema: fooCached,
		}),
		// piece-end: cache
		// piece-start: live
		fooLiveUpdates: {
			send: async (update) => {
				state.fooLiveUpdatesSent.push(update);
			},
		},
		// piece-end: live
		barReadRepository: barRepositoryMemoryCreate(state),
		fooReadRepository: fooRepositoryMemoryCreate(state),
		// wiring: ports
		fooClock: clock,
		fooTransaction: fooTransactionMemoryCreate(state),
	};
	return { clock, ports, state };
};
