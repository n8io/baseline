import { postgresTransaction } from "@n8io/baseline-postgres";
import {
	type Inbox,
	type Queue,
	queueEventsPgBoss,
	queueInboxInsert,
} from "@n8io/baseline-queue";
import { ok, type Result } from "@n8io/baseline-result";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import type { FooEventMap } from "../models/foo.ts";
import type { FooTransaction, FooTransactionPorts } from "../ports.ts";
import { fooPortsGuard } from "./foo-ports-guard.ts";
import { fooRepositoryPostgres } from "./foo-repository.postgres.ts";

// One Postgres transaction: the rows and the events published with them commit or roll back
// together. A repeated inbox skips the work and commits nothing else.
export const fooTransactionPostgres = (
	pgPool: pg.Pool,
	queue: Queue,
): FooTransaction =>
	(<T, E>(
		work: (ports: FooTransactionPorts) => Promise<Result<T, E>>,
		inbox?: Inbox,
	) =>
		postgresTransaction(pgPool, async (pgClient) => {
			if (inbox && !(await queueInboxInsert(pgClient, inbox))) {
				return ok(undefined) as Result<T, E>;
			}
			let open = true;
			const isOpen = (): boolean => open;
			try {
				return await work({
					fooEvents: fooPortsGuard(
						queueEventsPgBoss<FooEventMap>(queue, pgClient),
						isOpen,
					),
					fooRepository: fooPortsGuard(
						fooRepositoryPostgres(drizzle({ client: pgClient })),
						isOpen,
					),
				});
			} finally {
				open = false;
			}
		})) as FooTransaction;
