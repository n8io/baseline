// How Drizzle's db.transaction fits a Result: it rolls back only on a throw.
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { TransactionRollbackError } from "drizzle-orm/errors";
import { err, ok, type Result } from "../shared/result.ts";
import { fooCount, pgPoolCreate, schemaReset } from "./db.ts";
import { check, failureCount } from "./harness.ts";

const pgPool = pgPoolCreate({ max: 2 });
await schemaReset(pgPool);
const db = drizzle({ client: pgPool });
const insert = (tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0], name: string) =>
  tx.execute(sql`insert into foo (id, name) values (${crypto.randomUUID()}, ${name})`);

await check("[drizzle] returning an err from db.transaction COMMITS the writes", async () => {
  const result = await db.transaction(async (tx) => {
    await insert(tx, "drizzle-err");
    return err("nope");
  });
  assert.equal(result.ok, false);
  assert.equal(await fooCount(pgPool, "drizzle-err"), 1);
});

await check("[drizzle] tx.rollback() throws TransactionRollbackError out of db.transaction", async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      await insert(tx, "drizzle-rollback");
      tx.rollback();
    }),
    TransactionRollbackError,
  );
  assert.equal(await fooCount(pgPool, "drizzle-rollback"), 0);
});

// The adapter shape that maps a Result onto Drizzle: roll back on err, return the err.
const drizzleResultTransaction = async <T, E>(work: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<Result<T, E>>) => {
  let result: Result<T, E> | undefined;
  try {
    return await db.transaction(async (tx) => {
      result = await work(tx);
      if (!result.ok) tx.rollback();
      return result;
    });
  } catch (error) {
    if (error instanceof TransactionRollbackError && result && !result.ok) return result;
    throw error;
  }
};

await check("[drizzle] a small wrapper makes err roll back and still return the err", async () => {
  const result = await drizzleResultTransaction(async (tx) => {
    await insert(tx, "drizzle-wrapped");
    return err("nope");
  });
  assert.deepEqual(result, { ok: false, error: "nope" });
  assert.equal(await fooCount(pgPool, "drizzle-wrapped"), 0);
  assert.equal((await drizzleResultTransaction(async (tx) => ok(await insert(tx, "drizzle-ok")))).ok, true);
  assert.equal(await fooCount(pgPool, "drizzle-ok"), 1);
});

await check("[drizzle] tx.transaction nests with a savepoint; inner rollback keeps the outer write", async () => {
  await db.transaction(async (tx) => {
    await insert(tx, "drizzle-outer");
    await tx
      .transaction(async (inner) => {
        await insert(inner, "drizzle-inner");
        inner.rollback();
      })
      .catch((error) => {
        if (!(error instanceof TransactionRollbackError)) throw error;
      });
  });
  assert.equal(await fooCount(pgPool, "drizzle-outer"), 1);
  assert.equal(await fooCount(pgPool, "drizzle-inner"), 0);
});

await pgPool.end();
process.exitCode = failureCount() > 0 ? 1 : 0;
