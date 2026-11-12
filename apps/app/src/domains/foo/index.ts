// The domain's entry: everything outside foo imports from here, api/index.ts or spi/index.ts.
export type { FooError } from "./foo-errors.ts";
export {
	FooForbiddenError,
	FooNameTakenError,
	FooNotFoundError,
} from "./foo-errors.ts";
export {
	Foo,
	type FooCreated,
	FooCreateInput,
	type FooDeleted,
	FooDeleteInput,
	type FooEventMap,
	FooGetInput,
	type FooList,
	FooListInput,
	FooUpdateInput,
	fooCreated,
	fooDeleted,
} from "./models/foo.ts";
export type {
	// piece-start: cache
	FooCache,
	// piece-end: cache
	FooEvents,
	// piece-start: live
	FooLiveUpdates,
	// piece-end: live
	FooPorts,
	FooReadRepository,
	FooRepository,
	FooTransaction,
	FooTransactionPorts,
} from "./ports.ts";
export {
	type FooUseCases,
	fooUseCasesCreate,
} from "./use-cases/foo-use-cases.ts";

// Scopes an actor may hold to change other people's foos.
export const fooScopes = ["foo:update", "foo:delete"] as const;
