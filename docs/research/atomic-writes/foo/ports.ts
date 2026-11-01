import type { Result } from "../shared/result.ts";
import type { Foo } from "./models/foo.ts";

// Reads that need no transaction. No write method exists here.
export type FooReadRepository = {
  findById(id: string): Promise<Foo | undefined>;
  findByName(name: string): Promise<Foo | undefined>;
};

// Reads and writes, bound to one transaction. Only the transaction hands it out.
export type FooRepository = FooReadRepository & {
  insert(foo: Foo): Promise<Foo>;
};

// What the work inside a transaction can reach. No fooTransaction here, so nesting cannot be written.
export type FooTransactionPorts = { fooRepository: FooRepository };

// Commits when the work returns ok. Rolls back when it returns err or throws.
export type FooTransaction = <T, E>(
  work: (ports: FooTransactionPorts) => Promise<Result<T, E>>,
) => Promise<Result<T, E>>;

export type FooPorts = {
  fooReadRepository: FooReadRepository;
  fooTransaction: FooTransaction;
};
