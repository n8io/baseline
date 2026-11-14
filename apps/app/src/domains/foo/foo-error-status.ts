import type { FooError } from "./foo-errors.ts";

// Every foo error's HTTP status, for the API and for pages. A new FooError fails type-checking here until it is mapped.
export const fooErrorStatus = {
	FooForbidden: 403,
	FooNameTaken: 409,
	FooNotFound: 404,
} as const satisfies Record<FooError["type"], number>;
