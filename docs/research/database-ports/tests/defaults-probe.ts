// Prints the effective pool and connection defaults of the installed pg, and which connection-string keys it reads.
import pg from "pg";
import { createRequire } from "node:module";
const { parse } = createRequire(new URL(import.meta.resolve("pg")))("pg-connection-string") as { parse: (s: string) => unknown };
const base = "postgres://u:p@h:5432/d";
const pool = new pg.Pool({ connectionString: base });
const o = pool.options as unknown as Record<string, unknown>;
console.log("Pool options (connectionString only):", JSON.stringify({ max: o.max, idleTimeoutMillis: o.idleTimeoutMillis, connectionTimeoutMillis: o.connectionTimeoutMillis, maxLifetimeSeconds: o.maxLifetimeSeconds, allowExitOnIdle: o.allowExitOnIdle, maxUses: o.maxUses, min: o.min }));
const client = new pg.Client({ connectionString: base }) as any;
const cp = client.connectionParameters;
console.log("Client params:", JSON.stringify({ statement_timeout: cp.statement_timeout, query_timeout: cp.query_timeout, connect_timeout: cp.connect_timeout, keepalives: cp.keepalives, keepalives_idle: cp.keepalives_idle, lock_timeout: cp.lock_timeout, idle_in_transaction_session_timeout: cp.idle_in_transaction_session_timeout }), "client._connectionTimeoutMillis", client._connectionTimeoutMillis, "keepAlive (socket)", client.connection.stream?.constructor?.name);
for (const key of ["connect_timeout=7", "connectionTimeoutMillis=7000", "statement_timeout=1234", "query_timeout=4321", "keepalives=0", "idle_in_transaction_session_timeout=999", "lock_timeout=555", "max=3", "idleTimeoutMillis=5"]) {
  const c = new pg.Client({ connectionString: `${base}?${key}` }) as any;
  const p = new pg.Pool({ connectionString: `${base}?${key}` });
  const q = c.connectionParameters;
  console.log(`?${key} ->`, JSON.stringify({ connect_timeout: q.connect_timeout, statement_timeout: q.statement_timeout, query_timeout: q.query_timeout, keepalives: q.keepalives, lock_timeout: q.lock_timeout, idle_in_tx: q.idle_in_transaction_session_timeout, poolMax: p.options.max, poolIdle: p.options.idleTimeoutMillis, poolConnTimeout: (p.options as any).connectionTimeoutMillis, clientConnTimeout: c._connectionTimeoutMillis }));
}
console.log("pg-connection-string parse of ?connect_timeout=7:", JSON.stringify(parse(`${base}?connect_timeout=7`)));
