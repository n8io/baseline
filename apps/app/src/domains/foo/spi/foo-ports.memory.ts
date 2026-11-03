import type { FooLiveUpdates, FooPorts } from "../ports.ts";
import { fooCacheMemory } from "./foo-cache.memory.ts";
import {
	type FooMemoryState,
	fooMemoryStateCreate,
	fooRepositoryMemory,
} from "./foo-repository.memory.ts";
import {
	type FooPublished,
	fooTransactionMemory,
} from "./foo-transaction.memory.ts";

export type FooLiveUpdate = Parameters<FooLiveUpdates["send"]>[0];

// Every foo port in memory, plus what they recorded: committed events and sent live updates.
export const fooPortsMemory = (): {
	ports: FooPorts;
	published: FooPublished[];
	sent: FooLiveUpdate[];
	state: FooMemoryState;
} => {
	const state = fooMemoryStateCreate();
	const published: FooPublished[] = [];
	const sent: FooLiveUpdate[] = [];
	return {
		ports: {
			fooCache: fooCacheMemory(),
			fooLiveUpdates: {
				send: async (update) => {
					sent.push(update);
				},
			},
			fooReadRepository: fooRepositoryMemory(state),
			fooTransaction: fooTransactionMemory(state, published),
		},
		published,
		sent,
		state,
	};
};
