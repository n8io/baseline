import {
	postgresPortsGuard,
	postgresTransactionRun,
} from "@n8io/baseline-postgres";
import {
	type Inbox,
	type Queue,
	queueEventsPgBossCreate,
	queueInboxInsert,
} from "@n8io/baseline-queue";
import { ok, type Result } from "@n8io/baseline-result";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import type { FooEventMap } from "../models/foo.ts";
import type { FooTransaction, FooTransactionPorts } from "../ports.ts";
import { fooRepositoryPostgresCreate } from "./foo-repository.postgres.ts";

// One Postgres transaction: everything the work writes commits or rolls back together.
export const fooTransactionPostgresCreate = (
	pgPool: pg.Pool,
	// piece-start: queue
	// Events publish in the same transaction; a repeated inbox skips the work and commits nothing.
	queue: Queue,
	// piece-end: queue
): FooTransaction =>
	(<T, E>(
		work: (ports: FooTransactionPorts) => Promise<Result<T, E>>,
		// piece-start: queue
		inbox?: Inbox,
		// piece-end: queue
	) =>
		postgresTransactionRun(pgPool, async (pgClient) => {
			// piece-start: queue
			if (inbox && !(await queueInboxInsert(pgClient, inbox))) {
				return ok(undefined) as Result<T, E>;
			}
			// piece-end: queue
			let open = true;
			const isOpen = (): boolean => open;
			try {
				return await work({
					// piece-start: queue
					fooEvents: postgresPortsGuard(
						queueEventsPgBossCreate<FooEventMap>(queue, pgClient),
						isOpen,
					),
					// piece-end: queue
					fooRepository: postgresPortsGuard(
						fooRepositoryPostgresCreate(drizzle({ client: pgClient })),
						isOpen,
					),
				});
			} finally {
				open = false;
			}
		})) as FooTransaction;
