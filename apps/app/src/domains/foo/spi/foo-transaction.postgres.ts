import { postgresTransactionRun } from "@n8io/baseline-postgres";
import {
	type Events,
	type EventsPublisher,
	type Inbox,
	queueInboxInsert,
} from "@n8io/baseline-queue";
import { ok, type Result } from "@n8io/baseline-result";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import { transactionPortsGuard } from "../../../transaction-ports-guard.ts";
import type { FooEventMap } from "../models/foo.ts";
import type { FooTransaction, FooTransactionPorts } from "../ports.ts";
import { fooRepositoryPostgresCreate } from "./foo-repository.postgres.ts";

// One Postgres transaction: everything the work writes commits or rolls back together.
export const fooTransactionPostgresCreate = (
	pgPool: pg.Pool,
	// piece-start: queue
	// Events publish in the transaction; a repeated inbox skips the work and commits nothing.
	events: Events,
	// piece-end: queue
): FooTransaction =>
	(async <T, E>(
		work: (ports: FooTransactionPorts) => Promise<Result<T, E>>,
		// piece-start: queue
		inbox?: Inbox,
		// piece-end: queue
	) => {
		// piece-start: queue
		let fooEvents: EventsPublisher<FooEventMap> | undefined;
		// piece-end: queue
		const result = await postgresTransactionRun(pgPool, async (pgClient) => {
			// piece-start: queue
			if (inbox && !(await queueInboxInsert(pgClient, inbox))) {
				return ok(undefined) as Result<T, E>;
			}
			fooEvents = events.publisherCreate<FooEventMap>(pgClient);
			// piece-end: queue
			let open = true;
			const isOpen = (): boolean => open;
			try {
				return await work({
					// piece-start: queue
					fooEvents: transactionPortsGuard(fooEvents, isOpen),
					// piece-end: queue
					fooRepository: transactionPortsGuard(
						fooRepositoryPostgresCreate(drizzle({ client: pgClient })),
						isOpen,
					),
				});
			} finally {
				open = false;
			}
		});
		// piece-start: queue
		// The transaction has committed: a transport outside it sends its Events now.
		if (result.ok) await fooEvents?.committed();
		// piece-end: queue
		return result;
	}) as FooTransaction;
