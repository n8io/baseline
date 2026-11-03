import type { RedisClient } from "@n8io/baseline-cache";
import type { LiveHub } from "@n8io/baseline-live";
import type { Queue } from "@n8io/baseline-queue";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import type { FooPorts } from "../ports.ts";
import { fooCacheMemory } from "./foo-cache.memory.ts";
import { fooCacheRedis } from "./foo-cache.redis.ts";
import { fooPortsMemory } from "./foo-ports.memory.ts";
import { fooRepositoryPostgres } from "./foo-repository.postgres.ts";
import { fooTransactionPostgres } from "./foo-transaction.postgres.ts";

// Picks the adapters for each port: Postgres or memory for the repository and transaction
// (the queue lives in the same Postgres, so database and queue are both real or both memory),
// Redis or memory for the cache. Composition roots own every connection.
export const fooPortsCreate = (options: {
	database: pg.Pool | "memory";
	cache: RedisClient | "memory";
	queue: Queue | "memory";
	liveHub: LiveHub;
}): FooPorts => {
	const { cache, database, liveHub, queue } = options;
	if ((database === "memory") !== (queue === "memory")) {
		throw new TypeError(
			"database and queue must both be Postgres or both memory",
		);
	}
	const repository =
		database === "memory" || queue === "memory"
			? fooPortsMemory().ports
			: {
					fooReadRepository: fooRepositoryPostgres(
						drizzle({ client: database }),
					),
					fooTransaction: fooTransactionPostgres(database, queue),
				};
	return {
		fooReadRepository: repository.fooReadRepository,
		fooTransaction: repository.fooTransaction,
		fooCache: cache === "memory" ? fooCacheMemory() : fooCacheRedis(cache),
		fooLiveUpdates: { send: (update) => liveHub.send("foo", update) },
	};
};
