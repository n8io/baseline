import type { Result } from "../shared/result.ts";
import type { FooNameTakenError } from "./foo-errors.ts";
import type { Foo } from "./models/foo.ts";

export type FooReadRepository = {
  findById(id: string): Promise<Foo | undefined>;
  findByName(name: string): Promise<Foo | undefined>;
};

export type FooRepository = FooReadRepository & {
  insert(foo: Foo): Promise<Result<Foo, FooNameTakenError>>;
};

export type FooTransactionPorts = { fooRepository: FooRepository };

export type FooTransaction = <T, E>(
  work: (ports: FooTransactionPorts) => Promise<Result<T, E>>,
) => Promise<Result<T, E>>;

export type FooPorts = { fooReadRepository: FooReadRepository; fooTransaction: FooTransaction };
