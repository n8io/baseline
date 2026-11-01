// BullMQ 6 on Node 26 (native TS): Postgres 18 backend and Redis 8 via node-redis.
import { Queue, Worker, createNodeRedisClient, createPostgresBackend, runMigrations } from "bullmq";
import pg from "pg";
import { createClient } from "redis";

const url = "postgres://postgres:pg@127.0.0.1:55499/postgres";
const results: Record<string, unknown> = {};
const pool = new pg.Pool({ connectionString: url });
await pool.query("drop schema if exists bullmq cascade");
{
  const c = await pool.connect();
  await runMigrations(c);
  c.release();
}

// Postgres backend.
const opts = { connection: url };
const queue = new Queue("foo-created", opts, createPostgresBackend);

// 1. Is there any way to add a job inside our own transaction? add() takes no client.
const client = await pool.connect();
await client.query("begin");
await queue.add("foo-created", { id: "rollback" });
await client.query("rollback");
client.release();
const rows = await pool.query("select count(*)::int as n from bullmq.job");
results.pgJobsAfterOurRollback = rows.rows[0].n;

// 2. Retries end in a failed state (no dead-letter queue).
let attempts = 0;
const flakyQueue = new Queue("foo-flaky", opts, createPostgresBackend);
const flaky = new Worker(
  "foo-flaky",
  async () => {
    attempts++;
    throw new Error("boom");
  },
  opts,
  createPostgresBackend,
);
const job = await flakyQueue.add("x", { id: "flaky" }, { attempts: 3 });
for (let i = 0; i < 40 && (await job.getState?.()) !== "failed"; i++) {
  const s = await flakyQueue.getJobState(job.id!);
  if (s === "failed") break;
  await new Promise((r) => setTimeout(r, 250));
}
results.pgAttempts = attempts;
results.pgFinalState = await flakyQueue.getJobState(job.id!);
await flaky.close();

// 3. Graceful close waits for in-flight.
let finished = false;
const slowQueue = new Queue("foo-slow", opts, createPostgresBackend);
const slow = new Worker(
  "foo-slow",
  async () => {
    await new Promise((r) => setTimeout(r, 3000));
    finished = true;
  },
  opts,
  createPostgresBackend,
);
await slowQueue.add("x", {});
await new Promise((r) => setTimeout(r, 800));
const t0 = Date.now();
await slow.close();
results.pgCloseMs = Date.now() - t0;
results.pgInFlightFinished = finished;
await Promise.all([queue.close(), flakyQueue.close(), slowQueue.close()]);

// 4. Redis backend via node-redis on a default redis:8 container.
const raw = createClient({ url: "redis://127.0.0.1:56499" });
await raw.connect();
results.redisMaxmemoryPolicy = await raw.configGet("maxmemory-policy");
const rq = new Queue("foo-created", { connection: createNodeRedisClient(raw) });
let got: unknown;
const rw = new Worker(
  "foo-created",
  async (j) => {
    got = j.data;
  },
  { connection: createNodeRedisClient(raw.duplicate()) },
);
await rq.add("x", { id: "redis" });
for (let i = 0; i < 40 && !got; i++) await new Promise((r) => setTimeout(r, 100));
results.redisNodeRedisProcessed = got;
await rw.close();
await rq.close();

console.log(JSON.stringify(results, null, 2));
await pool.end();
process.exit(0);
