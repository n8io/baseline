import type { Id } from "@n8io/baseline-id";
import type { Result } from "@n8io/baseline-result";
import type { FooNameTakenError, FooNotFoundError } from "./errors.ts";
import type { Foo, FooList, FooListInput } from "./foo.ts";

export type FooReadRepository = {
	findById(id: Id<"foo">): Promise<Foo | undefined>;
	list(input: FooListInput): Promise<FooList>;
};

// Each write names only the errors it can return.
export type FooRepositoryInsertError = FooNameTakenError;
export type FooRepositoryUpdateError = FooNameTakenError | FooNotFoundError;
export type FooRepositoryDeleteError = FooNotFoundError;

// Writes happen only through this, and only fooTransaction hands it out.
export type FooRepository = FooReadRepository & {
	// Reads like findById and locks the row until the transaction ends: read through this before
	// a write that depends on what was read, so a concurrent write waits instead of being undone.
	findByIdForUpdate(id: Id<"foo">): Promise<Foo | undefined>;
	insert(foo: Foo): Promise<Result<Foo, FooRepositoryInsertError>>;
	// A row deleted since it was read answers FooNotFoundError, never a throw.
	update(foo: Foo): Promise<Result<Foo, FooRepositoryUpdateError>>;
	delete(id: Id<"foo">): Promise<Result<void, FooRepositoryDeleteError>>;
	// domain-create-start: schedule
	// Archives every foo with updatedAt < before and archivedAt null; returns how many.
	archiveStale(before: Date, now: Date): Promise<number>;
	// domain-create-end: schedule
};
