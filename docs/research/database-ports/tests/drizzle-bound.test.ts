// Q1-Q3: Drizzle bound to the checked-out client inside postgresTransaction.
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { FooNameTakenError } from "../foo/foo-errors.ts";
import type { FooRepository } from "../foo/ports.ts";
import { fooReadRepositoryPostgres, fooTransactionPostgres } from "../foo/spi/foo-repository.postgres.ts";
import { fooCreate } from "../foo/use-cases/foo-create.ts";
import { err, ok } from "../shared/result.ts";
import { barrierCreate, check, failureCount, sleep } from "./harness.ts";
import { fooCount, pgPoolCreate, schemaReset, tagCount } from "./db.ts";

const pgPool = pgPoolCreate({ max: 2, application_name: "db-ports-test" });
const monitor = pgPoolCreate({ max: 1, application_name: "db-ports-monitor" });
await schemaReset(pgPool);
const fooTransaction = fooTransactionPostgres(pgPool);
const foo = (name: string, tags: string[] = ["a", "b"]) => ({ id: crypto.randomUUID(), name, tags });
const sessions = async () =>
  (await monitor.query("select state, count(*)::int as n from pg_stat_activity where application_name = 'db-ports-test' group by state")).rows;

await check("[1] ok result commits foo and its tags (both tables)", async () => {
  const result = await fooTransaction(({ fooRepository }) => fooRepository.insert(foo("commit")));
  assert.equal(result.ok, true);
  assert.equal(await fooCount(pgPool, "commit"), 1);
  assert.equal(await tagCount(pgPool), 2);
  const read = await fooReadRepositoryPostgres(pgPool).findByName("commit");
  assert.deepEqual(read?.tags, ["a", "b"]);
});

await check("[1] err result after a write rolls back", async () => {
  const result = await fooTransaction(async ({ fooRepository }) => {
    await fooRepository.insert(foo("err-after-write"));
    return err("nope");
  });
  assert.equal(result.ok, false);
  assert.equal(await fooCount(pgPool, "err-after-write"), 0);
});

await check("[1] throw after a write rolls back and rethrows", async () => {
  await assert.rejects(
    fooTransaction(async ({ fooRepository }) => {
      await fooRepository.insert(foo("throw-after-write"));
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(await fooCount(pgPool, "throw-after-write"), 0);
});

await check("[1] SQL error mid-transaction (tag check constraint) rolls back the foo row", async () => {
  const before = await tagCount(pgPool);
  let caught: unknown;
  await fooTransaction(({ fooRepository }) => fooRepository.insert(foo("sql-error", ["x".repeat(30)]))).catch((e) => (caught = e));
  assert.ok(caught instanceof DrizzleQueryError, String(caught));
  assert.equal((caught as { cause?: { code?: string } }).cause?.code, "23514");
  assert.equal(await fooCount(pgPool, "sql-error"), 0);
  assert.equal(await tagCount(pgPool), before);
});

await check("[1] closed-scope guard: a repository kept after the transaction throws and writes nothing", async () => {
  let kept!: FooRepository;
  await fooTransaction(async ({ fooRepository }) => {
    kept = fooRepository;
    return ok(undefined);
  });
  // Drizzle wraps the guard's error: the top-level message is only "Failed query: ...", the guard text is in `cause`.
  const guarded = (e: unknown) => e instanceof DrizzleQueryError && /after its transaction ended/.test((e.cause as Error).message);
  await assert.rejects(kept.insert(foo("late")), guarded);
  await assert.rejects(kept.findByName("late"), guarded);
  // not awaited write started inside the work, lands after the end
  let late!: Promise<unknown>;
  await fooTransaction(async ({ fooRepository }) => {
    late = sleep(20).then(() => fooRepository.insert(foo("late2")));
    return ok(undefined);
  });
  await assert.rejects(late, guarded);
  assert.equal(await fooCount(pgPool, "late"), 0);
  assert.equal(await fooCount(pgPool, "late2"), 0);
});

await check("[1] control: WITHOUT the guard a kept Drizzle instance writes on the released client", async () => {
  let kept!: NodePgDatabase;
  const pgClient = await pgPool.connect();
  kept = drizzle({ client: pgClient });
  pgClient.release();
  const { fooTable } = await import("../foo/spi/foo-table.ts");
  await kept.insert(fooTable).values({ id: crypto.randomUUID(), name: "unguarded" });
  assert.equal(await fooCount(pgPool, "unguarded"), 1);
});

await check("[1] 400 mixed transactions on a pool of 2: no leaked or idle-in-transaction sessions", async () => {
  const create = fooCreate({ fooTransaction });
  const kinds = ["ok", "err", "throw", "sqlerror", "dup"] as const;
  await create({ name: "mixed-dup", tags: [] });
  const outcomes: Record<string, number> = {};
  const count = (key: string) => (outcomes[key] = (outcomes[key] ?? 0) + 1);
  await Promise.all(
    Array.from({ length: 400 }, async (_, i) => {
      const kind = kinds[i % kinds.length]!;
      try {
        if (kind === "ok") count((await create({ name: `mixed-${i}`, tags: ["t"] })).ok ? "ok" : "bad");
        if (kind === "err") count((await fooTransaction(async ({ fooRepository }) => { await fooRepository.insert(foo(`mixed-err-${i}`)); return err("x"); })).ok ? "bad" : "err");
        if (kind === "throw") await fooTransaction(async ({ fooRepository }) => { await fooRepository.insert(foo(`mixed-throw-${i}`)); throw new Error("boom"); }).catch(() => count("throw"));
        if (kind === "sqlerror") await create({ name: `mixed-sql-${i}`, tags: ["x".repeat(30)] }).catch(() => count("sqlerror"));
        if (kind === "dup") count((await create({ name: "mixed-dup", tags: [] })).ok ? "bad" : "dup");
      } catch (e) { count(`unexpected ${e}`); }
    }),
  );
  console.log(`  outcomes ${JSON.stringify(outcomes)}`);
  assert.deepEqual(outcomes, { ok: 80, err: 80, throw: 80, sqlerror: 80, dup: 80 });
  assert.equal(pgPool.totalCount, pgPool.idleCount, "client checked out");
  assert.equal(pgPool.waitingCount, 0);
  const rows = await sessions();
  console.log(`  sessions ${JSON.stringify(rows)}, pool total ${pgPool.totalCount} idle ${pgPool.idleCount}`);
  assert.ok(rows.every((r) => r.state === "idle"), JSON.stringify(rows));
  assert.ok(rows.reduce((n, r) => n + r.n, 0) <= 2);
  assert.equal(await fooCount(pgPool, "mixed-dup"), 1);
  assert.equal((await pgPool.query("select count(*)::int n from foo where name like 'mixed-err-%' or name like 'mixed-throw-%' or name like 'mixed-sql-%'")).rows[0].n, 0);
});

await check("[2] exact shape of a Drizzle unique violation", async () => {
  await fooTransaction(({ fooRepository }) => fooRepository.insert(foo("shape")));
  const db = drizzle({ client: pgPool });
  const { fooTable } = await import("../foo/spi/foo-table.ts");
  let caught: any;
  try { await db.insert(fooTable).values({ id: crypto.randomUUID(), name: "shape" }); } catch (e) { caught = e; }
  console.log(`  class ${caught.constructor.name}, instanceof DrizzleQueryError ${caught instanceof DrizzleQueryError}, instanceof Error ${caught instanceof Error}`);
  console.log(`  message: ${JSON.stringify(caught.message)}`);
  console.log(`  own keys: ${Object.keys(caught).join(",")}; query: ${caught.query}; params: ${JSON.stringify(caught.params)}`);
  console.log(`  cause class ${caught.cause?.constructor.name}; cause.code ${caught.cause?.code}; cause.constraint ${caught.cause?.constraint}; cause.table ${caught.cause?.table}; cause.detail ${caught.cause?.detail}; cause.message ${JSON.stringify(caught.cause?.message)}`);
  assert.ok(caught instanceof DrizzleQueryError);
  const wrapper = caught as { code?: string; cause?: { code?: string; constraint?: string } };
  assert.equal(wrapper.code, undefined, "code is NOT on the wrapper");
  assert.equal(wrapper.cause?.code, "23505");
  assert.equal(wrapper.cause?.constraint, "foo_name_unique");
});

await check("[2] duplicate id (primary key, other constraint) is NOT mapped to FooNameTakenError", async () => {
  const dup = foo("pk-1");
  await fooTransaction(({ fooRepository }) => fooRepository.insert(dup));
  await assert.rejects(
    fooTransaction(({ fooRepository }) => fooRepository.insert({ ...dup, name: "pk-2" })),
    (e: unknown) => e instanceof DrizzleQueryError && (e.cause as { constraint?: string } | undefined)?.constraint === "foo_pkey",
  );
});

await check("[2] 10 concurrent creates of one name: exactly one ok, nine FooNameTakenError", async () => {
  const create = fooCreate({ fooTransaction });
  const results = await Promise.all(Array.from({ length: 10 }, () => create({ name: "race", tags: ["a"] })));
  const oks = results.filter((r) => r.ok);
  const errs = results.filter((r) => !r.ok);
  assert.equal(oks.length, 1);
  assert.equal(errs.length, 9);
  assert.ok(errs.every((r) => !r.ok && r.error instanceof FooNameTakenError && r.error.fooName === "race"));
  assert.equal(await fooCount(pgPool, "race"), 1);
});

await check("[2] two inserts both in flight before either commits (barrier): one ok, one FooNameTakenError", async () => {
  const arrive = barrierCreate(2);
  const run = () =>
    fooTransaction(async ({ fooRepository }) => {
      await arrive(); // both hold a client and an open transaction before either inserts
      return fooRepository.insert(foo("barrier"));
    });
  const results = await Promise.all([run(), run()]);
  assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
});

await check("[3] FooReadRepository on the pool: runs outside any transaction and does not see uncommitted rows", async () => {
  const read = fooReadRepositoryPostgres(pgPool);
  const db = drizzle({ client: pgPool });
  const probe = () => (() => db.execute(sql`select current_setting('transaction_timeout') as t, (pg_current_xact_id_if_assigned() is null) as no_xact`).then((r) => (Array.isArray(r) ? r[0]! : r).rows[0] as { t: string; no_xact: boolean }))();
  const inside = fooTransaction(async ({ fooRepository }) => {
    const result = await fooRepository.insert(foo("uncommitted"));
    await sleep(300);
    return result;
  });
  await sleep(100);
  const outside = await probe();
  assert.equal(outside.t, "0", "pool query must not carry the 5s transaction_timeout of a transaction");
  assert.equal(await read.findByName("uncommitted"), undefined, "uncommitted row must be invisible");
  const idleInTx = (await monitor.query("select count(*)::int n from pg_stat_activity where application_name='db-ports-test' and state='idle in transaction'")).rows[0].n;
  console.log(`  during an open transaction: pool-query transaction_timeout=${outside.t}, sessions idle in transaction=${idleInTx} (the writer, waiting in sleep)`);
  await inside;
  assert.equal((await read.findByName("uncommitted"))?.name, "uncommitted");
});

await monitor.end();
await pgPool.end();
process.exitCode = failureCount() > 0 ? 1 : 0;
