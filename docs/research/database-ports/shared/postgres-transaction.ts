import type { Pool, PoolClient } from "pg";

// Shared SPI helper (would live in a database package). Domain code never imports it.
export type PostgresTransactionScope = { open: boolean };

export const postgresTransaction = async <R extends { ok: boolean }>(
  pgPool: Pool,
  work: (pgClient: PoolClient, scope: PostgresTransactionScope) => Promise<R>,
  { timeoutMs = 5000 }: { timeoutMs?: number } = {},
): Promise<R> => {
  const pgClient = await pgPool.connect();
  const scope: PostgresTransactionScope = { open: true };
  let destroy = false;
  // A checked-out client emits 'error' when its connection dies. With no listener Node crashes.
  const onError = () => {
    destroy = true;
  };
  pgClient.on("error", onError);
  try {
    await pgClient.query("BEGIN");
    await pgClient.query(`SET LOCAL transaction_timeout = ${Math.trunc(timeoutMs)}`);
    const result = await work(pgClient, scope);
    await pgClient.query(result.ok ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    try {
      await pgClient.query("ROLLBACK");
    } catch {
      destroy = true; // broken connection: do not return it to the pool
    }
    throw error;
  } finally {
    scope.open = false;
    pgClient.off("error", onError);
    pgClient.release(destroy);
  }
};

// Closed-scope guard for libraries that take a client (Drizzle). A Proxy keeps the PoolClient type;
// any query after the transaction ended throws instead of running on a connection that may belong to another request.
export const postgresClientScoped = (pgClient: PoolClient, scope: PostgresTransactionScope): PoolClient =>
  new Proxy(pgClient, {
    get(target, property, receiver) {
      if (property === "query") {
        return (...args: unknown[]) => {
          if (!scope.open) throw new Error("Repository used after its transaction ended");
          return (target.query as (...a: unknown[]) => unknown)(...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
