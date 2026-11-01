import type { Pool, PoolClient } from "pg";

// Shared SPI helper (would live in a database package). Domain code never imports it.
// The scope flag lets bound repositories refuse queries after the transaction ends.
export type PgTransactionScope = { open: boolean };

export const pgTransaction = async <R extends { ok: boolean }>(
  pgPool: Pool,
  work: (client: PoolClient, scope: PgTransactionScope) => Promise<R>,
): Promise<R> => {
  const client = await pgPool.connect();
  const scope: PgTransactionScope = { open: true };
  let destroy = false;
  // A checked-out client emits 'error' when its connection dies (for example the
  // server ends it). With no listener Node crashes the process. The failed query
  // still rejects, so the listener only marks the client for destruction.
  const onError = () => {
    destroy = true;
  };
  client.on("error", onError);
  try {
    await client.query("BEGIN");
    const result = await work(client, scope);
    await client.query(result.ok ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      destroy = true; // the connection is broken; do not return it to the pool
    }
    throw error;
  } finally {
    scope.open = false;
    client.off("error", onError);
    client.release(destroy);
  }
};

// Wraps a client so any query after the transaction ended throws instead of
// running on a connection that may now belong to another request.
export const pgScopedQuery =
  (client: PoolClient, scope: PgTransactionScope) =>
  (text: string, values?: unknown[]) => {
    if (!scope.open) throw new Error("Repository used after its transaction ended");
    return client.query(text, values);
  };
