import type { Result } from "@n8io/baseline-result";
import { sharedIntegerAssert, sharedTimerMaxMs } from "@n8io/baseline-shared";
import { postgresLoggerDefault as logger } from "./postgres-logger-default.ts";
import type {
	PostgresClient,
	PostgresTransactionRunConnection,
	PostgresTransactionRunPool,
} from "./postgres-pool.ts";

// A client that throws on any use once its transaction has ended, so a callback that leaks it
// (a stray promise, a closure kept for later) fails loudly instead of running outside it.
const clientGuard = (
	pgClient: PostgresTransactionRunConnection,
	isOpen: () => boolean,
): PostgresTransactionRunConnection =>
	new Proxy(pgClient, {
		get(target, property) {
			if (!isOpen()) {
				throw new Error(
					"Postgres client used after its transaction ended; keep every query inside the callback",
				);
			}
			const value: unknown = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});

/** What `postgresTransactionRun` takes. */
export type PostgresTransactionRunOptions<T, E> = {
	/** The pool to check one client out of. */
	pgPool: PostgresTransactionRunPool;
	/** How long the transaction may run before Postgres ends it. Default 5 s. */
	timeoutMs?: number | null;
	/** Runs on the transaction's client; an ok Result commits, an err Result rolls back. */
	work: (pgClient: PostgresClient) => Promise<Result<T, E>>;
};

/**
 * Runs `work` in one transaction on one checked-out client: COMMIT on ok, ROLLBACK on err or a
 * throw. transaction_timeout (Postgres 17+) ends a transaction that runs longer than timeoutMs.
 * Throws a TypeError at the call on a `timeoutMs` that is not a positive integer or is over
 * 2147483647.
 */
export const postgresTransactionRun = async <T, E>({
	pgPool,
	timeoutMs: timeoutMsGiven,
	work,
}: PostgresTransactionRunOptions<T, E>): Promise<Result<T, E>> => {
	const timeoutMs = timeoutMsGiven ?? 5_000;
	sharedIntegerAssert({
		caller: "postgresTransactionRun",
		max: sharedTimerMaxMs,
		min: 1,
		name: "timeoutMs",
		value: timeoutMs,
	});
	const pgClient = await pgPool.connect();
	let broken = false;
	let open = true;
	const onError = (error: Error): void => {
		broken = true;
		logger().error({ err: error }, "Postgres transaction client error");
	};
	pgClient.on("error", onError);
	try {
		await pgClient.query("BEGIN");
		await pgClient.query(`SET LOCAL transaction_timeout = '${timeoutMs}ms'`);
		let result: Result<T, E>;
		try {
			result = await work(clientGuard(pgClient, () => open));
		} finally {
			open = false;
		}
		await pgClient.query(result.ok ? "COMMIT" : "ROLLBACK");
		return result;
	} catch (error) {
		try {
			await pgClient.query("ROLLBACK");
		} catch {
			broken = true;
		}
		throw error;
	} finally {
		open = false;
		pgClient.off("error", onError);
		pgClient.release(broken || undefined);
	}
};
