// The same all-or-nothing contract, run against every FooTransaction adapter.
import assert from "node:assert/strict";
import { err, ok } from "../shared/result.ts";
import { FooNameTakenError } from "../foo/foo-errors.ts";
import type { FooReadRepository, FooRepository, FooTransaction } from "../foo/ports.ts";
import { fooCreate } from "../foo/use-cases/foo-create.ts";
import { check } from "./harness.ts";

export type FooTransactionSubject = {
  label: string;
  setup: () => Promise<{ fooTransaction: FooTransaction; fooReadRepository: FooReadRepository }>;
};

const fooMake = (name: string) => ({ id: crypto.randomUUID(), name, tags: ["a", "b"] });

export const fooTransactionContract = async ({ label, setup }: FooTransactionSubject) => {
  await check(`[${label}] ok commits the foo and its tags`, async () => {
    const { fooTransaction, fooReadRepository } = await setup();
    const foo = fooMake("one");
    const result = await fooTransaction(async ({ fooRepository }) => ok(await fooRepository.insert(foo)));
    assert.equal(result.ok, true);
    assert.deepEqual(await fooReadRepository.findById(foo.id), foo);
  });

  await check(`[${label}] err after a write rolls back and returns the err`, async () => {
    const { fooTransaction, fooReadRepository } = await setup();
    const foo = fooMake("two");
    const result = await fooTransaction(async ({ fooRepository }) => {
      await fooRepository.insert(foo);
      assert.ok(await fooRepository.findById(foo.id), "reads inside see their own writes");
      return err(new FooNameTakenError(foo.name));
    });
    assert.equal(result.ok, false);
    assert.equal(await fooReadRepository.findById(foo.id), undefined);
  });

  await check(`[${label}] a throw after a write rolls back and rethrows the same error`, async () => {
    const { fooTransaction, fooReadRepository } = await setup();
    const foo = fooMake("three");
    const boom = new Error("boom");
    await assert.rejects(
      fooTransaction(async ({ fooRepository }) => {
        await fooRepository.insert(foo);
        throw boom;
      }),
      (error) => error === boom,
    );
    assert.equal(await fooReadRepository.findById(foo.id), undefined);
  });

  await check(`[${label}] a repository kept past the end of its transaction throws`, async () => {
    const { fooTransaction } = await setup();
    let kept: FooRepository | undefined;
    await fooTransaction(async ({ fooRepository }) => {
      kept = fooRepository;
      return ok(undefined);
    });
    await assert.rejects(async () => kept?.insert(fooMake("late")), /used after its transaction ended/);
  });

  await check(`[${label}] fooCreate returns FooNameTakenError for a taken name`, async () => {
    const { fooTransaction } = await setup();
    const create = fooCreate({ fooTransaction });
    assert.equal((await create({ name: "dup", tags: [] })).ok, true);
    const second = await create({ name: "dup", tags: [] });
    assert.equal(second.ok, false);
    assert.ok(!second.ok && second.error instanceof FooNameTakenError);
  });
};
