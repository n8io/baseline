// Which pg callback forms lose the AsyncLocalStorage store? Prints counts.
import { AsyncLocalStorage } from "node:async_hooks";
import { pgPoolCreate } from "./db.ts";

const store = new AsyncLocalStorage<number>();
const n = 20;

const probe = async (label: string, start: (i: number, done: (seen: number | undefined) => void) => void) => {
  const seen = await Promise.all(
    Array.from({ length: n }, (_, i) => store.run(i, () => new Promise<number | undefined>((resolve) => start(i, resolve)))),
  );
  const lost = seen.filter((s, i) => s !== i).length;
  console.log(`  ${label}: ${lost}/${n} callbacks saw another caller's store`);
  return lost;
};

const pool = pgPoolCreate({ max: 1 });
const results: Record<string, number> = {
  poolConnectQueued: await probe("pool.connect(cb), 20 callers on a pool of 1", (_, done) =>
    pool.connect((e, client, release) => {
      done(store.getStore());
      release();
    }),
  ),
  poolQueryQueued: await probe("pool.query(text, cb), 20 callers on a pool of 1", (_, done) =>
    pool.query("select 1", () => done(store.getStore())),
  ),
};
const client = await pool.connect();
results.clientQueryQueued = await probe("client.query(text, cb), 20 callers on one client", (_, done) =>
  client.query("select 1", () => done(store.getStore())),
);
client.release();
const big = pgPoolCreate({ max: 25 });
await Promise.all(Array.from({ length: 20 }, () => big.query("select 1"))); // warm 20 connections
results.poolQueryNotQueued = await probe("pool.query(text, cb), 20 callers on a warm pool of 25", (_, done) =>
  big.query("select 1", () => done(store.getStore())),
);
await pool.end();
await big.end();
console.log(JSON.stringify(results));
