// Q5: cost of drizzle(client) per transaction vs reusing one instance. No database round trip.
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { fooTable } from "../foo/spi/foo-table.ts";
import { postgresClientScoped } from "../shared/postgres-transaction.ts";

const pgClient = new pg.Client() as unknown as pg.PoolClient; // never connected; only construction is measured
const scope = { open: true };
const N = 10_000;
const time = (label: string, fn: () => unknown) => {
  for (let i = 0; i < 1000; i++) fn(); // warm up
  const start = process.hrtime.bigint();
  for (let i = 0; i < N; i++) fn();
  const ns = Number(process.hrtime.bigint() - start);
  console.log(`${label}: ${(ns / 1e6).toFixed(1)} ms for ${N}, ${(ns / N / 1000).toFixed(2)} us each`);
};
const shared = drizzle(pgClient);
time("drizzle(client)                          ", () => drizzle(pgClient));
time("drizzle(scoped proxy(client))            ", () => drizzle(postgresClientScoped(pgClient, scope)));
time("reuse one instance (property read only)  ", () => shared.$client);
time("build a select query (no run), reused db ", () => shared.select().from(fooTable).where(eq(fooTable.name, "x")).toSQL());
const mem = (make: () => unknown) => {
  globalThis.gc?.();
  const before = process.memoryUsage().heapUsed;
  const keep = Array.from({ length: 10_000 }, make);
  globalThis.gc?.();
  return { bytesEach: Math.round((process.memoryUsage().heapUsed - before) / keep.length) };
};
console.log("heap per drizzle(client) instance:", JSON.stringify(mem(() => drizzle(pgClient))));
console.log("own keys of a drizzle instance:", Object.keys(shared).join(","));
console.log("session own keys:", Object.keys((shared as any).session).join(","));
