import type { Queue } from "@n8io/baseline-queue";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Connections } from "../../../connections.ts";
import type { FooPorts } from "../ports.ts";
import { fooCacheMemoryCreate } from "./foo-cache.memory.ts";
import { fooCacheRedisCreate } from "./foo-cache.redis.ts";
import { fooPortsMemoryCreate } from "./foo-ports.memory.ts";
import { fooRepositoryPostgresCreate } from "./foo-repository.postgres.ts";
import { fooTransactionPostgresCreate } from "./foo-transaction.postgres.ts";

// Picks each port's adapter from the connections the composition root opened: a real one, or
// "memory". Composition roots own every connection.
export const fooPortsCreate = (connections: Connections): FooPorts => {
	const { database } = connections;
	// piece-start: queue
	// The queue lives in the same Postgres as the repository: both real or both memory.
	const { queue } = connections;
	if ((database === "memory") !== (queue === "memory")) {
		throw new TypeError(
			"database and queue must both be Postgres or both memory",
		);
	}
	// piece-end: queue
	const repository =
		database === "memory"
			? fooPortsMemoryCreate().ports
			: {
					fooReadRepository: fooRepositoryPostgresCreate(
						drizzle({ client: database }),
					),
					fooTransaction: fooTransactionPostgresCreate(
						database,
						// piece-start: queue
						queue as Queue, // Postgres too: checked above.
						// piece-end: queue
					),
				};
	return {
		// piece-start: analytics
		fooAnalytics: {
			track: ({ actorId, fooId, name }) =>
				connections.analytics.track({
					actorId,
					name,
					properties: { fooId },
				}),
		},
		// piece-end: analytics
		// piece-start: cache
		fooCache:
			connections.redis === "memory"
				? fooCacheMemoryCreate()
				: fooCacheRedisCreate(connections.redis),
		// piece-end: cache
		fooReadRepository: repository.fooReadRepository,
		fooTransaction: repository.fooTransaction,
		// piece-start: live
		fooLiveUpdates: {
			send: (update) => connections.liveHub.send("foo", update),
		},
		// piece-end: live
	};
};
