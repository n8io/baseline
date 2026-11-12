import type { RedisClient } from "@n8io/baseline-cache";
import type { LiveHub } from "@n8io/baseline-live";
import type { Queue } from "@n8io/baseline-queue";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import type { FooPorts } from "../ports.ts";
import { fooCacheMemoryCreate } from "./foo-cache.memory.ts";
import { fooCacheRedisCreate } from "./foo-cache.redis.ts";
import { fooPortsMemoryCreate } from "./foo-ports.memory.ts";
import { fooRepositoryPostgresCreate } from "./foo-repository.postgres.ts";
import { fooTransactionPostgresCreate } from "./foo-transaction.postgres.ts";

// Picks each port's adapter from what the composition root passes: a connection, or "memory".
// The queue lives in the same Postgres as the repository, so database and queue are both real
// or both memory. Composition roots own every connection.
export const fooPortsCreate = (options: {
	database: pg.Pool | "memory";
	// piece-start: cache
	cache: RedisClient | "memory";
	// piece-end: cache
	queue: Queue | "memory";
	// piece-start: live
	liveHub: LiveHub;
	// piece-end: live
}): FooPorts => {
	const { database, queue } = options;
	if ((database === "memory") !== (queue === "memory")) {
		throw new TypeError(
			"database and queue must both be Postgres or both memory",
		);
	}
	const repository =
		database === "memory" || queue === "memory"
			? fooPortsMemoryCreate().ports
			: {
					fooReadRepository: fooRepositoryPostgresCreate(
						drizzle({ client: database }),
					),
					fooTransaction: fooTransactionPostgresCreate(database, queue),
				};
	return {
		fooReadRepository: repository.fooReadRepository,
		fooTransaction: repository.fooTransaction,
		// piece-start: cache
		fooCache:
			options.cache === "memory"
				? fooCacheMemoryCreate()
				: fooCacheRedisCreate(options.cache),
		// piece-end: cache
		// piece-start: live
		fooLiveUpdates: {
			send: (update) => options.liveHub.send("foo", update),
		},
		// piece-end: live
	};
};
