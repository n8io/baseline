// Q8: pool exhaustion, connectionTimeoutMillis, and pgPool.end() with waiters.
import assert from "node:assert/strict";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { check, failureCount, sleep } from "./harness.ts";

const exporter = new InMemorySpanExporter();
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
trace.setGlobalTracerProvider(new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] }));
registerInstrumentations({ instrumentations: [new PgInstrumentation()] });
const { pgPoolCreate } = await import("./db.ts");
const { postgresTransaction } = await import("../shared/postgres-transaction.ts");

const hold = (pgPool: ReturnType<typeof pgPoolCreate>, ms: number) =>
  postgresTransaction(pgPool, async (pgClient) => {
    await pgClient.query("select 1");
    await sleep(ms);
    return { ok: true as const };
  });

type Outcome = { ok: boolean; ms: number; name?: string; message?: string; stack?: string | undefined };
const timed = async (promise: Promise<unknown>, start: number): Promise<Outcome> =>
  promise.then(
    () => ({ ok: true, ms: Date.now() - start }),
    (e: Error) => ({ ok: false, ms: Date.now() - start, name: e.constructor.name, message: e.message, stack: e.stack?.split("\n")[1]?.trim() }),
  );

for (const holdMs of [1000, 2000]) {
  for (const connectionTimeoutMillis of [undefined, 1000, 5000]) {
    await check(`[8] pool max 2, 3 transactions hold ${holdMs} ms, connectionTimeoutMillis ${connectionTimeoutMillis ?? "unset"}`, async () => {
      const pgPool = pgPoolCreate({ max: 2, ...(connectionTimeoutMillis ? { connectionTimeoutMillis } : {}) });
      exporter.reset();
      const start = Date.now();
      const tracer = trace.getTracer("test");
      const outcomes = await Promise.all(
        [0, 1, 2].map((i) =>
          tracer.startActiveSpan(`request ${i}`, async (span) => {
            const outcome = await timed(hold(pgPool, holdMs), start);
            span.end();
            return outcome;
          }),
        ),
      );
      console.log(`  outcomes ${JSON.stringify(outcomes.map((o) => ({ ok: o.ok, ms: o.ms, ...(o.ok ? {} : { name: o.name, message: o.message }) })))}`);
      const connects = exporter.getFinishedSpans().filter((s) => s.name === "pg-pool.connect");
      console.log(`  pg-pool.connect spans: ${JSON.stringify(connects.map((s) => ({ ms: Math.round(s.endTime[0] * 1e3 + s.endTime[1] / 1e6 - (s.startTime[0] * 1e3 + s.startTime[1] / 1e6)), status: s.status.code, message: s.status.message, events: s.events.map((e) => e.name), attrs: Object.fromEntries(Object.entries(s.attributes).filter(([k]) => k.includes("pool") || k.includes("error"))) })))}`);
      const failed = outcomes.filter((o) => !o.ok);
      // hold 1000 with timeout 1000 is a tie: the holder releases about 20 ms after 1000 (COMMIT + release), so the timeout wins.
      if (connectionTimeoutMillis && connectionTimeoutMillis <= holdMs) assert.equal(failed.length, 1);
      else assert.equal(failed.length, 0);
      // recovery: a later transaction works, pool shows no waiter, no leaked client
      assert.equal((await timed(hold(pgPool, 10), Date.now())).ok, true);
      console.log(`  after: total ${pgPool.totalCount} idle ${pgPool.idleCount} waiting ${pgPool.waitingCount}`);
      assert.equal(pgPool.waitingCount, 0);
      assert.equal(pgPool.totalCount, pgPool.idleCount);
      await pgPool.end();
    });
  }
}

// A promise that gives up waiting, so a hang shows as "pending after N ms" instead of ending the process.
const settledWithin = <T,>(promise: Promise<T>, ms: number) =>
  Promise.race([promise.then((value) => ({ settled: true as const, value })), sleep(ms).then(() => ({ settled: false as const }))]);

for (const connectionTimeoutMillis of [undefined, 5000]) {
  await check(`[8] pgPool.end() with 2 callers waiting for a connection (pool of 1, connectionTimeoutMillis ${connectionTimeoutMillis ?? "unset"})`, async () => {
    const pgPool = pgPoolCreate({ max: 1, ...(connectionTimeoutMillis ? { connectionTimeoutMillis } : {}) });
    const start = Date.now();
    const holder = timed(hold(pgPool, 1000), start);
    await sleep(50);
    const waiters = [timed(hold(pgPool, 10), start), timed(hold(pgPool, 10), start)];
    await sleep(150);
    console.log(`  before end(): total ${pgPool.totalCount} idle ${pgPool.idleCount} waiting ${pgPool.waitingCount}`);
    const ended = pgPool.end().then(() => Date.now() - start);
    const lateConnect = await timed(pgPool.connect(), Date.now());
    console.log(`  connect() after end(): ${JSON.stringify(lateConnect)}`);
    console.log(`  holder: ${JSON.stringify(await holder)}`);
    console.log(`  end() promise: ${JSON.stringify(await settledWithin(ended, 7000))}`);
    await sleep(6000 - (Date.now() - start) + 200 > 0 ? 6000 - (Date.now() - start) + 200 : 0);
    console.log(`  waiters ${Date.now() - start} ms after start (end() was called at ~200 ms): ${JSON.stringify(await Promise.all(waiters.map((w) => settledWithin(w, 1))))}; pool waiting ${pgPool.waitingCount}, total ${pgPool.totalCount}`);
  });
}
process.exitCode = failureCount() > 0 ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 100); // hung waiters would otherwise keep nothing alive; exit explicitly
