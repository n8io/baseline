import { err, ok, type Result } from "../../shared/result.ts";
import { FooNameTakenError } from "../foo-errors.ts";
import type { Foo, FooCreateInput } from "../models/foo.ts";
import type { FooPorts } from "../ports.ts";

export const fooCreate =
  ({ fooTransaction }: Pick<FooPorts, "fooTransaction">) =>
  (input: FooCreateInput): Promise<Result<Foo, FooNameTakenError>> =>
    fooTransaction(async ({ fooRepository }) => {
      if (await fooRepository.findByName(input.name)) return err(new FooNameTakenError(input.name));
      return ok(await fooRepository.insert({ id: crypto.randomUUID(), name: input.name, tags: input.tags }));
    });
