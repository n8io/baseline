// pg-boss 12 on Node 26 (native TS) + Postgres 18.
import { context, propagation, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import pg from "pg";
import { PgBoss, TestClock } from "pg-boss";

const url = "postgres://postgres:pg@127.0.0.1:55499/postgres";
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register({ propagator: new W3CTraceContextPropagator() });

const results: Record<string, unknown> = {};
const pool = new pg.Pool({ connectionString: url });
await pool.query("drop schema if exists pgboss cascade; drop table if exists foo");
await pool.query("create table foo (id text primary key)");

const boss = new PgBoss({
  connectionString: url,
  openTelemetry: { propagateContext: true },
  __test__enableSpies: true,
});
boss.on("error", (e) => console.error("boss error", e));
await boss.start();

console.error("step 1", JSON.stringify(results));
await boss.createQueue("foo-created");
const txDb = (client: pg.PoolClient) => ({
  executeSql: (text: string, values: unknown[]) => client.query(text, values),
});
for (const outcome of ["rollback", "commit"] as const) {
  const client = await pool.connect();
  await client.query("begin");
  await client.query("insert into foo values ($1)", [outcome]);
  await boss.send("foo-created", { id: outcome }, { db: txDb(client) });
  await client.query(outcome);
  client.release();
}
const queued = await pool.query(
  "select data->>'id' as id from pgboss.job where name = 'foo-created'",
);
results.outboxJobsAfterRollbackAndCommit = queued.rows.map((r) => r.id);

console.error("step 2", JSON.stringify(results));
const tracer = trace.getTracer("test");
await tracer.startActiveSpan("fooCreate", async (span) => {
  await boss.send("foo-created", {
    actor: { type: "user", id: "u1" },
    id: "traced",
  });
  results.producerTraceId = span.spanContext().traceId;
  span.end();
});
const tc = await pool.query(
  "select trace_context from pgboss.job where data->>'id' = 'traced'",
);
results.storedTraceContext = tc.rows[0]?.trace_context;
let consumerTraceId = "";
let consumerActor: unknown;
await boss.work("foo-created", async ([job]) => {
  consumerTraceId = trace.getActiveSpan()?.spanContext().traceId ?? "";
  consumerActor = (job.data as { actor?: unknown }).actor;
});
await boss
  .getSpy("foo-created")
  .waitForJob((d: { id?: string }) => d.id === "traced", "completed");
results.consumerTraceIdMatches = consumerTraceId === results.producerTraceId;
results.consumerActor = consumerActor;
await boss.offWork("foo-created");

console.error("step 3", JSON.stringify(results));
await boss.createQueue("foo-dlq");
await boss.createQueue("foo-flaky", {
  deadLetter: "foo-dlq",
  retryDelay: 0,
  retryLimit: 2,
});
let attempts = 0;
await boss.work("foo-flaky", { pollingIntervalSeconds: 0.5 }, async () => {
  attempts++;
  throw new Error("boom");
});
await boss.send("foo-flaky", { id: "flaky" });
let dead: { data: unknown; source_name?: string } | undefined;
for (let i = 0; i < 60 && !dead; i++) {
  await new Promise((r) => setTimeout(r, 500));
  dead = (await pool.query("select * from pgboss.job where name = 'foo-dlq'")).rows[0];
}
results.attemptsBeforeDeadLetter = attempts;
results.deadLetterJob = dead && { data: dead.data, source: dead.source_name };
await boss.offWork("foo-flaky");

console.error("step 4", JSON.stringify(results));
await boss.createQueue("bar-foo-created");
await boss.createQueue("baz-foo-created");
await boss.subscribe("foo.created", "bar-foo-created");
await boss.subscribe("foo.created", "baz-foo-created");
{
  const client = await pool.connect();
  await client.query("begin");
  await boss.publish("foo.created", { id: "fan" }, { db: txDb(client) });
  await client.query("commit");
  client.release();
}
const fan = await pool.query(
  "select name from pgboss.job where data->>'id' = 'fan' order by name",
);
results.fanOutQueues = fan.rows.map((r) => r.name);

console.error("step 5", JSON.stringify(results));
const delayedId = await boss.send("foo-created", { id: "later" }, { startAfter: 2 });
const t0 = Date.now();
await boss.work("foo-created", { pollingIntervalSeconds: 0.5 }, async () => {});
await boss.getSpy("foo-created").waitForJobWithId(delayedId!, "completed");
results.delayedRanAfterMs = Date.now() - t0;
await boss.offWork("foo-created");

console.error("step 6", JSON.stringify(results));
await boss.createQueue("foo-slow");
let finished = false;
await boss.work("foo-slow", { pollingIntervalSeconds: 0.5 }, async () => {
  await new Promise((r) => setTimeout(r, 3000));
  finished = true;
});
const slowId = await boss.send("foo-slow", { id: "slow" });
await boss.getSpy("foo-slow").waitForJobWithId(slowId!, "active");
const s0 = Date.now();
await boss.stop({ graceful: true, timeout: 10_000 });
results.gracefulStopMs = Date.now() - s0;
results.inFlightFinishedBeforeStopResolved = finished;
const slowState = await pool.query("select state from pgboss.job where id = $1", [slowId]);
results.slowJobState = slowState.rows[0]?.state;

console.error("step 7", JSON.stringify(results));
await pool.query("drop schema if exists pgboss cascade");
const clock = new TestClock("2026-11-01T00:00:10Z");
const a = new PgBoss({ clock, connectionString: url });
const b = new PgBoss({ clock, connectionString: url });
await a.start();
await b.start();
await a.createQueue("foo-nightly");
await a.schedule("foo-nightly", "* * * * *");
await b.schedule("foo-nightly", "* * * * *");
await clock.tick(5 * 60_000);
const cron = await pool.query("select count(*)::int as n from pgboss.job where name = 'foo-nightly'");
results.cronJobsIn5MinWith2Instances = cron.rows[0].n;
await a.stop();
await b.stop();

const spans = exporter.getFinishedSpans().map((s) => s.name);
results.spanNames = [...new Set(spans)].sort();
console.log(JSON.stringify(results, null, 2));
await pool.end();
await provider.shutdown();
void context;
void propagation;
