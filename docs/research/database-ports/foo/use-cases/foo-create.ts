import type { Result } from "../../shared/result.ts";
import type { FooNameTakenError } from "../foo-errors.ts";
import type { Foo, FooCreateInput } from "../models/foo.ts";
import type { FooPorts } from "../ports.ts";

export const fooCreate =
  ({ fooTransaction }: Pick<FooPorts, "fooTransaction">) =>
  (input: FooCreateInput): Promise<Result<Foo, FooNameTakenError>> =>
    fooTransaction(({ fooRepository }) =>
      fooRepository.insert({ id: crypto.randomUUID(), name: input.name, tags: input.tags }),
    );
