// piece-start: cache
import type { RedisClient } from "@n8io/baseline-cache";
// piece-end: cache
import type { LiveHub } from "@n8io/baseline-live";
import type { Queue } from "@n8io/baseline-queue";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import type { FooPorts } from "../ports.ts";
// piece-start: cache
import { fooCacheMemoryCreate } from "./foo-cache.memory.ts";
import { fooCacheRedisCreate } from "./foo-cache.redis.ts";
// piece-end: cache
import { fooPortsMemoryCreate } from "./foo-ports.memory.ts";
import { fooRepositoryPostgresCreate } from "./foo-repository.postgres.ts";
import { fooTransactionPostgresCreate } from "./foo-transaction.postgres.ts";

// Picks the adapters for each port: Postgres or memory for the repository and transaction
// (the queue lives in the same Postgres, so database and queue are both real or both memory),
// and Redis or memory for the cache. Composition roots own every connection.
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
