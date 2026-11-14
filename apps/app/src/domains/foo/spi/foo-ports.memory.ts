import { cacheCreate, cacheStoreMemoryCreate } from "@n8io/baseline-cache";
import { type ClockMemory, clockMemoryCreate } from "../../../clock.ts";
import type { FooPorts } from "../ports.ts";
import { fooCached } from "./foo-cached.ts";
import {
	fooMemoryStateCreate,
	fooRepositoryMemoryCreate,
} from "./foo-repository.memory.ts";
import { fooTransactionMemoryCreate } from "./foo-transaction.memory.ts";

// Every foo port in memory, plus the state they share: committed foos and, with the queue,
// committed events. The clock stands still until the test moves it. The state also records what
// the live updates and analytics ports were given, in order, for a test to read.
export const fooPortsMemoryCreate = () => {
	const clock: ClockMemory = clockMemoryCreate();
	const state = {
		...fooMemoryStateCreate(),
		// piece-start: analytics
		// `committed`: whether the foo was already committed when the event was tracked.
		analyticsTracked: [] as (Parameters<
			FooPorts["fooAnalytics"]["track"]
		>[0] & { committed: boolean })[],
		// piece-end: analytics
		// piece-start: live
		liveUpdatesSent: [] as Parameters<FooPorts["fooLiveUpdates"]["send"]>[0][],
		// piece-end: live
	};
	const ports: FooPorts = {
		// piece-start: analytics
		fooAnalytics: {
			track: (event) => {
				state.analyticsTracked.push({
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
		fooClock: clock,
		// piece-start: live
		fooLiveUpdates: {
			send: async (update) => {
				state.liveUpdatesSent.push(update);
			},
		},
		// piece-end: live
		fooReadRepository: fooRepositoryMemoryCreate(state),
		fooTransaction: fooTransactionMemoryCreate(state),
	};
	return { clock, ports, state };
};
