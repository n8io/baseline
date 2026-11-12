// The domain's entry: everything outside foo imports from here, api/index.ts or spi/index.ts.
export * from "./foo-errors.ts";
export * from "./models/foo.ts";
export type * from "./ports.ts";
export {
	type FooUseCases,
	fooUseCasesCreate,
} from "./use-cases/foo-use-cases.ts";

// Scopes an actor may hold to change other people's foos.
export const fooScopes = ["foo:update", "foo:delete"] as const;
