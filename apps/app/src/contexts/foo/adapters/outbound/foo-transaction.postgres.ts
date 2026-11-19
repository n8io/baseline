import {
	type PostgresPool,
	postgresTransactionRun,
} from "@n8io/baseline-postgres";
import {
	type Events,
	type Inbox,
	queueInboxInsert,
} from "@n8io/baseline-queue";
import { ok, type Result } from "@n8io/baseline-result";
import { drizzle } from "drizzle-orm/node-postgres";
import { transactionPortsGuard } from "../../../../transaction-ports-guard.ts";
import type {
	FooTransaction,
	FooTransactionPorts,
} from "../../application/ports.ts";
import type { FooEventMap } from "../../domain/foo.ts";
import { barRepositoryPostgresCreate } from "./bar-repository.postgres.ts";
import { fooRepositoryPostgresCreate } from "./foo-repository.postgres.ts";

// One Postgres transaction: everything the work writes, in every Aggregate of the context,
// commits or rolls back together.
export const fooTransactionPostgresCreate = (
	pgPool: PostgresPool,
	// piece-start: queue
	// Events publish in the transaction; a repeated inbox skips the work and commits nothing.
	events: Events,
	// piece-end: queue
): FooTransaction =>
	(async <T, E>(
		work: (ports: FooTransactionPorts) => Promise<Result<T, E>>,
		// piece-start: queue
		inbox?: Inbox | null,
		// piece-end: queue
	) => {
		// piece-start: queue
		const committed: (() => Promise<void>)[] = [];
		// piece-end: queue
		const result = await postgresTransactionRun({
			pgPool,
			work: async (pgClient) => {
				let open = true;
				const isOpen = (): boolean => open;
				const db = drizzle({ client: pgClient });
				// piece-start: queue
				if (inbox && !(await queueInboxInsert(pgClient, inbox))) {
					return ok(undefined) as Result<T, E>;
				}
				// An Aggregate's Events port, publishing on this transaction's client. The Use case
				// gets publish only: committed() is this file's to call.
				const eventsCreate = <M extends Record<string, unknown>>() => {
					const publisher = events.publisherCreate<M>(pgClient);
					committed.push(publisher.committed);
					return transactionPortsGuard({ publish: publisher.publish }, isOpen);
				};
				// piece-end: queue
				try {
					return await work({
						barRepository: transactionPortsGuard(
							barRepositoryPostgresCreate(db),
							isOpen,
						),
						// piece-start: queue
						fooEvents: eventsCreate<FooEventMap>(),
						// piece-end: queue
						fooRepository: transactionPortsGuard(
							fooRepositoryPostgresCreate(db),
							isOpen,
						),
						// wiring: transaction-ports
					});
				} finally {
					open = false;
				}
			},
		});
		// piece-start: queue
		// The transaction has committed: the queue outside it sends its Events now.
		if (result.ok) for (const sent of committed) await sent();
		// piece-end: queue
		return result;
	}) as FooTransaction;
