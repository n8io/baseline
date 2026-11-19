// The context's entry: everything outside foo imports from here, adapters/inbound/index.ts or
// adapters/outbound/index.ts.

export {
	type FooUseCases,
	fooUseCasesCreate,
} from "./application/foo-use-cases.ts";
export type * from "./application/ports.ts";
export * from "./domain/errors.ts";
export * from "./domain/foo.ts";
export { fooDeleteCan } from "./domain/foo-delete-can.ts";
export { fooUpdateCan } from "./domain/foo-update-can.ts";
export type * from "./domain/repositories.ts";
export * from "./foo-error-status.ts";

// Scopes an actor may hold to change other people's foos.
export const fooScopes = ["foo:update", "foo:delete"] as const;
