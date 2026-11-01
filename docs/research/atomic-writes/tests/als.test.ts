// How AsyncLocalStorage behaves around pg, and option 3 (implicit transaction) next to option 1.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";
import { err, ok, type Result } from "../shared/result.ts";
import { fooTransactionPostgres } from "../foo/spi/foo-repository.postgres.ts";
import type { FooRepository } from "../foo/ports.ts";
import { fooCount, pgPoolCreate, schemaReset } from "./db.ts";
import { check, sleep } from "./harness.ts";

const requestStore = new AsyncLocalStorage<string>();

await check("[als] the store survives awaits on pool.connect, client.query and pool.query with 25 callers queued on a pool of 1", async () => {
  const pgPool = pgPoolCreate({ max: 1 });
  const mismatches: string[] = [];
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      requestStore.run(`req-${i}`, async () => {
        const expect = (step: string) => {
          if (requestStore.getStore() !== `req-${i}`) mismatches.push(`req-${i} ${step} saw ${requestStore.getStore()}`);
        };
        const client = await pgPool.connect();
        expect("after pool.connect");
        await client.query("select pg_sleep(0.002)");
        expect("after client.query");
        client.release();
        await pgPool.query("select 1");
        expect("after pool.query");
      }),
    ),
  );
  await pgPool.end();
  assert.deepEqual(mismatches, []);
});

await check("[als] FINDING: the callback forms pool.connect(cb), client.query(text, cb) and pool.query(text, cb) run callbacks in another caller's store", async () => {
  const pgPool = pgPoolCreate({ max: 1 });
  const mismatches: string[] = [];
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      requestStore.run(
        `req-${i}`,
        () =>
          new Promise<void>((resolve, reject) => {
            pgPool.connect((connectError, client, release) => {
              if (connectError || !client) return reject(connectError);
              if (requestStore.getStore() !== `req-${i}`) mismatches.push(`connect cb req-${i} saw ${requestStore.getStore()}`);
              client.query("select pg_sleep(0.002)", (queryError) => {
                if (requestStore.getStore() !== `req-${i}`) mismatches.push(`query cb req-${i} saw ${requestStore.getStore()}`);
                release();
                pgPool.query("select 1", (poolQueryError) => {
                  if (requestStore.getStore() !== `req-${i}`) mismatches.push(`pool.query cb req-${i} saw ${requestStore.getStore()}`);
                  if (queryError || poolQueryError) return reject(queryError ?? poolQueryError);
                  resolve();
                });
              });
            });
          }),
      ),
    ),
  );
  await pgPool.end();
  assert.ok(mismatches.length > 0, "expected context loss in callback forms");
  console.log(`  ${mismatches.length} of 75 callbacks saw another caller's store, e.g. "${mismatches[0]}"`);
});

// ---- Option 3: the repository finds the open transaction itself ----
const fooTransactionStore = new AsyncLocalStorage<PoolClient>();

const fooTransactionAls =
  (pgPool: Pool) =>
  async <T, E>(work: () => Promise<Result<T, E>>): Promise<Result<T, E>> => {
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      const result = await fooTransactionStore.run(client, work);
      await client.query(result.ok ? "COMMIT" : "ROLLBACK");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

const fooRepositoryAls = (pgPool: Pool) => ({
  insert: async (name: string) => {
    const queryable = fooTransactionStore.getStore() ?? pgPool;
    await queryable.query("insert into foo (id, name) values ($1, $2)", [crypto.randomUUID(), name]);
  },
});

const pgPool = pgPoolCreate({ max: 1 });
await schemaReset(pgPool);
const fooTransaction3 = fooTransactionAls(pgPool);
const fooRepository3 = fooRepositoryAls(pgPool);

await check("[option 3] the implicit transaction holds across awaits and an err rolls back", async () => {
  await fooTransaction3(async () => {
    await fooRepository3.insert("als-err");
    await sleep(5);
    await fooRepository3.insert("als-err");
    return err("nope");
  });
  assert.equal(await fooCount(pgPool, "als-err"), 0);
});

await check("[option 3] HAZARD: a forgotten transaction is silent; the write autocommits", async () => {
  await fooRepository3.insert("als-forgotten");
  assert.equal(await fooCount(pgPool, "als-forgotten"), 1);
});

await check("[option 3] HAZARD: a write started in one transaction and not awaited lands in the next caller's transaction", async () => {
  let late: Promise<void> | undefined;
  await fooTransaction3(async () => {
    late = new Promise((resolve, reject) => setTimeout(() => fooRepository3.insert("als-late").then(resolve, reject), 50));
    return ok(undefined); // returns without awaiting the write
  });
  // Another request gets the same pooled connection, sees the stray row, and rolls back.
  const other = await fooTransaction3(async () => {
    await sleep(150);
    const { rows } = await (fooTransactionStore.getStore() as PoolClient).query("select count(*)::int as n from foo where name = 'als-late'");
    return err(`other request saw ${rows[0].n} stray row(s) and failed`);
  });
  await late; // the stray write itself succeeded: no error anywhere
  assert.deepEqual(other, { ok: false, error: "other request saw 1 stray row(s) and failed" });
  assert.equal(await fooCount(pgPool, "als-late"), 0, "the first request's write vanished with the other request's rollback");
});

await check("[option 1] the same late write throws instead, because the bound repository is closed", async () => {
  const fooTransaction1 = fooTransactionPostgres(pgPool);
  let late: Promise<unknown> | undefined;
  await fooTransaction1(async ({ fooRepository }: { fooRepository: FooRepository }) => {
    late = sleep(50).then(() => fooRepository.insert({ id: crypto.randomUUID(), name: "opt1-late", tags: [] }));
    return ok(undefined);
  });
  await assert.rejects(late as Promise<unknown>, /used after its transaction ended/);
  assert.equal(await fooCount(pgPool, "opt1-late"), 0);
});

await pgPool.end();

import { failureCount as fooFailureCount } from "./harness.ts";
process.exitCode = fooFailureCount() > 0 ? 1 : 0;
