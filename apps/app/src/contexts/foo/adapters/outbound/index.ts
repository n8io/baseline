import type { Events } from "@n8io/baseline-queue";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Connections } from "../../../../connections.ts";
import type { FooPorts } from "../../application/ports.ts";
import { barRepositoryPostgresCreate } from "./bar-repository.postgres.ts";
import { fooCacheCreate } from "./foo-cached.ts";
import { fooPortsMemoryCreate } from "./foo-ports.memory.ts";
import { fooRepositoryPostgresCreate } from "./foo-repository.postgres.ts";
import { fooTransactionPostgresCreate } from "./foo-transaction.postgres.ts";

// Picks each port's adapter from the connections the composition root opened: a real one, or
// "memory". Composition roots own every connection.
export const fooPortsCreate = (connections: Connections): FooPorts => {
	const { database } = connections;
	// piece-start: queue
	// Events commit with the repository's rows: both real or both memory.
	const { events } = connections;
	if ((database === "memory") !== (events === "memory")) {
		throw new TypeError("database and events must both be real or both memory");
	}
	// piece-end: queue
	// A memory database gives every repository and the transaction one shared memory state.
	const repositories =
		database === "memory"
			? fooPortsMemoryCreate().ports
			: {
					barReadRepository: barRepositoryPostgresCreate(
						drizzle({ client: database }),
					),
					fooReadRepository: fooRepositoryPostgresCreate(
						drizzle({ client: database }),
					),
					// wiring: read-repositories
					fooTransaction: fooTransactionPostgresCreate(
						database,
						// piece-start: queue
						events as Events, // real too: checked above.
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
		fooCache: fooCacheCreate(connections.cacheStore),
		// piece-end: cache
		// piece-start: live
		fooLiveUpdates: {
			send: (update) => connections.liveHub.send("foo", update),
		},
		// piece-end: live
		barReadRepository: repositories.barReadRepository,
		fooReadRepository: repositories.fooReadRepository,
		// wiring: ports
		fooClock: connections.clock,
		fooTransaction: repositories.fooTransaction,
	};
};
