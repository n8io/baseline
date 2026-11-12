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

export type FooLiveUpdate = Parameters<FooLiveUpdates["send"]>[0];

// Every foo port in memory, plus what they recorded: committed events and sent live updates.
export const fooPortsMemoryCreate = (): {
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
			fooCache: fooCacheMemoryCreate(),
			fooLiveUpdates: {
				send: async (update) => {
					sent.push(update);
				},
			},
			fooReadRepository: fooRepositoryMemoryCreate(state),
			fooTransaction: fooTransactionMemoryCreate(state, published),
		},
		published,
		sent,
		state,
	};
};
