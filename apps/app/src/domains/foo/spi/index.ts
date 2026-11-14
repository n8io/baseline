import { cacheCreate } from "@n8io/baseline-cache";
import type { Events } from "@n8io/baseline-queue";
import { drizzle } from "drizzle-orm/node-postgres";
import { clockSystemCreate } from "../../../clock.ts";
import type { Connections } from "../../../connections.ts";
import type { FooPorts } from "../ports.ts";
import { fooCached } from "./foo-cached.ts";
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
		fooCache: cacheCreate(connections.cacheStore, {
			keyOf: (foo) => foo.id,
			prefix: "foo",
			schema: fooCached,
		}),
		// piece-end: cache
		fooClock: clockSystemCreate(),
		fooReadRepository: repository.fooReadRepository,
		fooTransaction: repository.fooTransaction,
		// piece-start: live
		fooLiveUpdates: {
			send: (update) => connections.liveHub.send("foo", update),
		},
		// piece-end: live
	};
};
