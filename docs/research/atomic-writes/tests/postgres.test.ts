import assert from "node:assert/strict";
import { err, ok } from "../shared/result.ts";
import { FooNameTakenError } from "../foo/foo-errors.ts";
import {
  fooReadRepositoryPostgres,
  fooRepositoryAggregatePostgres,
  fooTransactionPostgres,
} from "../foo/spi/foo-repository.postgres.ts";
import { fooCount, pgPoolCreate, schemaReset } from "./db.ts";
import { fooTransactionContract } from "./foo-transaction.contract.ts";
import { barrierCreate, check, sleep } from "./harness.ts";

const pgPool = pgPoolCreate({ max: 2 });
await schemaReset(pgPool);
const fooTransaction = fooTransactionPostgres(pgPool);

await fooTransactionContract({
  label: "postgres",
  setup: async () => ({ fooTransaction, fooReadRepository: fooReadRepositoryPostgres(pgPool) }),
});

await check("[postgres] 300 mixed ok/err/throw transactions leave the pool clean (max 2)", async () => {
  await Promise.all(
    Array.from({ length: 300 }, (_, i) =>
      fooTransaction(async ({ fooRepository }) => {
        await fooRepository.insert({ id: crypto.randomUUID(), name: `bulk-${i}`, tags: [] });
        if (i % 3 === 1) return err(new FooNameTakenError("x"));
        if (i % 3 === 2) throw new Error("boom");
        return ok(i);
      }).catch(() => undefined),
    ),
  );
  assert.ok(pgPool.totalCount <= 2, `totalCount ${pgPool.totalCount}`);
  assert.equal(pgPool.idleCount, pgPool.totalCount);
  assert.equal(pgPool.waitingCount, 0);
  const { rows } = await pgPool.query("select count(*)::int as n from foo where name like 'bulk-%'");
  assert.equal(rows[0].n, 100, "only the ok third committed");
  const idle = await pgPool.query("select count(*)::int as n from pg_stat_activity where state like 'idle in transaction%'");
  assert.equal(idle.rows[0].n, 0, "no connection left idle in a transaction");
});

await check("[postgres] an SQL error mid-transaction rolls back the earlier write and the pool stays usable", async () => {
  const id = crypto.randomUUID();
  await assert.rejects(
    fooTransaction(async ({ fooRepository }) => ok(await fooRepository.insert({ id, name: "long-tag", tags: ["x".repeat(30)] }))),
    /foo_tag_tag_check/,
  );
  assert.equal(await fooCount(pgPool, "long-tag"), 0);
  assert.equal((await fooTransaction(async () => ok(1))).ok, true);
});

await check("[postgres] a connection killed mid-transaction is destroyed, not returned to the pool", async () => {
  const before = pgPool.totalCount;
  await assert.rejects(
    fooTransaction(async ({ fooRepository }) => {
      await fooRepository.insert({ id: crypto.randomUUID(), name: "killed", tags: [] });
      await pgPool.query("select pg_terminate_backend(pid) from pg_stat_activity where state = 'idle in transaction'");
      await sleep(50);
      return ok(await fooRepository.findByName("killed"));
    }),
  );
  assert.equal(await fooCount(pgPool, "killed"), 0);
  assert.ok(pgPool.totalCount <= before, "the broken client was not kept");
  assert.equal((await fooTransaction(async () => ok(1))).ok, true, "next transaction works");
});

await check("[postgres] HAZARD: a pool-bound write inside the callback is not rolled back", async () => {
  await fooTransaction(async () => {
    await pgPool.query("insert into foo (id, name) values ($1, 'outside')", [crypto.randomUUID()]);
    return err(new FooNameTakenError("outside"));
  });
  assert.equal(await fooCount(pgPool, "outside"), 1, "the err did not undo it");
});

await check("[postgres] HAZARD: a nested transaction with a full pool waits forever (shown with a 500 ms timeout)", async () => {
  const smallPool = pgPoolCreate({ max: 1, connectionTimeoutMillis: 500 });
  const outer = fooTransactionPostgres(smallPool);
  await assert.rejects(
    outer(async () => outer(async () => ok(1))),
    /timeout exceeded when trying to connect/,
  );
  await smallPool.end();
});

await check("[postgres] a transaction does not stop the check-then-insert race (read committed)", async () => {
  const arrive = barrierCreate(2);
  const create = () =>
    fooTransaction(async ({ fooRepository }) => {
      const found = await fooRepository.findByName("race");
      await arrive();
      if (found) return err(new FooNameTakenError("race"));
      return ok(await fooRepository.insert({ id: crypto.randomUUID(), name: "race", tags: [] }));
    });
  const results = await Promise.all([create(), create()]);
  assert.deepEqual(results.map((r) => r.ok), [true, true]);
  assert.equal(await fooCount(pgPool, "race"), 2, "two foos with one name");
});

await check("[postgres] with a unique index the race loser throws 23505 (not an err)", async () => {
  await pgPool.query("delete from foo_tag; delete from foo; create unique index foo_name_unique on foo (name)");
  const arrive = barrierCreate(2);
  const create = () =>
    fooTransaction(async ({ fooRepository }) => {
      const found = await fooRepository.findByName("race2");
      await arrive();
      if (found) return err(new FooNameTakenError("race2"));
      return ok(await fooRepository.insert({ id: crypto.randomUUID(), name: "race2", tags: [] }));
    });
  const settled = await Promise.allSettled([create(), create()]);
  const rejected = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0]?.reason.code, "23505");
  await pgPool.query("drop index foo_name_unique");
});

await check("[postgres] option 5: one aggregate insert is atomic inside the adapter", async () => {
  const fooRepository = fooRepositoryAggregatePostgres(pgPool);
  await assert.rejects(fooRepository.insert({ id: crypto.randomUUID(), name: "agg", tags: ["ok", "y".repeat(30)] }));
  assert.equal(await fooCount(pgPool, "agg"), 0);
  const foo = { id: crypto.randomUUID(), name: "agg", tags: ["a", "b"] };
  await fooRepository.insert(foo);
  assert.deepEqual(await fooRepository.findById(foo.id), foo);
});

await check("[postgres] SET LOCAL idle_in_transaction_session_timeout ends a transaction held by a slow outside call", async () => {
  const client = await pgPool.connect();
  let destroy = false;
  const serverEnded: Error[] = [];
  client.on("error", (error) => serverEnded.push(error));
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '200ms'");
    await client.query("insert into foo (id, name) values ($1, 'slow')", [crypto.randomUUID()]);
    await sleep(600); // a slow HTTP call or publish while the transaction is open
    await assert.rejects(client.query("COMMIT"), /not queryable/);
    destroy = true;
    console.log(`  server ended the session: ${serverEnded.map((e) => e.message).join("; ")}`);
  } finally {
    client.release(destroy);
  }
  assert.equal(await fooCount(pgPool, "slow"), 0);
});

await check("[postgres] SET LOCAL transaction_timeout ends a transaction that runs too long", async () => {
  const client = await pgPool.connect();
  let destroy = false;
  const serverEnded: Error[] = [];
  client.on("error", (error) => serverEnded.push(error));
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL transaction_timeout = '300ms'");
    await client.query("insert into foo (id, name) values ($1, 'too-long')", [crypto.randomUUID()]);
    await sleep(150);
    await client.query("select 1");
    await sleep(300);
    await assert.rejects(client.query("COMMIT"), /not queryable/);
    destroy = true;
    console.log(`  server ended the session: ${serverEnded.map((e) => e.message).join("; ")}`);
  } finally {
    client.release(destroy);
  }
  assert.equal(await fooCount(pgPool, "too-long"), 0);
});

await pgPool.end();

import { failureCount as fooFailureCount } from "./harness.ts";
process.exitCode = fooFailureCount() > 0 ? 1 : 0;
