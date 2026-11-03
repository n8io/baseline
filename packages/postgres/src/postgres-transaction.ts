import { logger } from "@n8io/baseline-logger";
import type { Result } from "@n8io/baseline-result";
import type pg from "pg";

// A client that throws on any use once its transaction has ended, so a callback that leaks it
// (a stray promise, a closure kept for later) fails loudly instead of running outside it.
const clientGuard = (
	pgClient: pg.PoolClient,
	isOpen: () => boolean,
): pg.PoolClient =>
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

// Runs `work` in one transaction on one checked-out client: COMMIT on ok, ROLLBACK on err or a
// throw. transaction_timeout (Postgres 17+) ends a transaction that runs longer than timeoutMs.
export const postgresTransaction = async <T, E>(
	pgPool: pg.Pool,
	work: (pgClient: pg.PoolClient) => Promise<Result<T, E>>,
	options: { timeoutMs?: number } = {},
): Promise<Result<T, E>> => {
	const timeoutMs = options.timeoutMs ?? 5_000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
		throw new TypeError("timeoutMs must be a positive integer");
	}
	const pgClient = await pgPool.connect();
	let broken = false;
	let open = true;
	const onError = (error: Error): void => {
		broken = true;
		logger.error({ err: error }, "Postgres transaction client error");
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
