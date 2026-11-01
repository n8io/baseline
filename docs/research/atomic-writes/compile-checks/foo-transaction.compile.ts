// Run with `tsc --noEmit`. Each @ts-expect-error line must be a type error, or tsc fails with
// "Unused '@ts-expect-error' directive". The block at the end compiles: those mistakes the build does NOT catch.
import { ok } from "../shared/result.ts";
import type { Foo } from "../foo/models/foo.ts";
import type { FooPorts } from "../foo/ports.ts";

type FooEventPublisher = { publish(foo: Foo): Promise<void> };
const foo: Foo = { id: "1", name: "a", tags: [] };

export const caught = ({ fooTransaction, fooReadRepository }: FooPorts) => {
  // 1. Forgotten transaction: no write method exists outside fooTransaction.
  // @ts-expect-error Property 'insert' does not exist on type 'FooReadRepository'.
  void fooReadRepository.insert(foo);


  void fooTransaction(async (ports) => {
    // 3. Nested transaction: the work's ports have no fooTransaction.
    // @ts-expect-error Property 'fooTransaction' does not exist on type 'FooTransactionPorts'.
    void ports.fooTransaction;
    return ok(undefined);
  });

  // 4. Work must return a Result, so commit/rollback is always decided by ok/err.
  // @ts-expect-error Type 'Foo' is not assignable to type 'Result<unknown, unknown>'.
  void fooTransaction(async () => foo);
};

// 2. A use case that picks only fooTransaction cannot reach a pool-bound repository at all.
// (An agent can still widen the Pick; review or a lint rule must catch that.)
// @ts-expect-error Property 'fooReadRepository' does not exist on type 'Pick<FooPorts, "fooTransaction">'.
export const fooCreateWrong = ({ fooTransaction, fooReadRepository }: Pick<FooPorts, "fooTransaction">) => [fooTransaction, fooReadRepository];

export const notCaught = ({ fooTransaction, fooReadRepository }: FooPorts, fooEventPublisher: FooEventPublisher) =>
  fooTransaction(async ({ fooRepository }) => {
    // A. A read through the pool-bound repository inside the work: it runs outside the transaction.
    await fooReadRepository.findByName("a");
    // B. A slow outside call held inside the transaction.
    await fooEventPublisher.publish(foo);
    // C. A write that is not awaited (the adapter's closed-scope guard catches it at run time).
    setTimeout(() => void fooRepository.insert(foo), 10);
    return ok(undefined);
  });
