// Q7: the plain pg repository passes the same core checks (ok, 23505 mapping, rollback on err).
import assert from "node:assert/strict";
import { FooNameTakenError } from "../foo/foo-errors.ts";
import { fooReadRepositoryPg, fooTransactionPg } from "../foo/spi/foo-repository.pg.ts";
import { fooCreate } from "../foo/use-cases/foo-create.ts";
import { err } from "../shared/result.ts";
import { fooCount, pgPoolCreate, schemaReset, tagCount } from "./db.ts";
import { check, failureCount } from "./harness.ts";

const pgPool = pgPoolCreate({ max: 2 });
await schemaReset(pgPool);
const fooTransaction = fooTransactionPg(pgPool);
const create = fooCreate({ fooTransaction });

await check("[7] plain pg: ok commits both tables; read returns tags", async () => {
  assert.equal((await create({ name: "plain", tags: ["a", "b"] })).ok, true);
  assert.equal(await tagCount(pgPool), 2);
  assert.deepEqual((await fooReadRepositoryPg(pgPool).findByName("plain"))?.tags, ["a", "b"]);
});
await check("[7] plain pg: 10 concurrent creates of one name give one ok, nine FooNameTakenError", async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => create({ name: "plain-race", tags: [] })));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && r.error instanceof FooNameTakenError));
});
await check("[7] plain pg: err after a write rolls back", async () => {
  await fooTransaction(async ({ fooRepository }) => {
    await fooRepository.insert({ id: crypto.randomUUID(), name: "plain-rb", tags: [] });
    return err("x");
  });
  assert.equal(await fooCount(pgPool, "plain-rb"), 0);
});
await pgPool.end();
process.exitCode = failureCount() > 0 ? 1 : 0;
