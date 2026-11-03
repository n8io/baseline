import type { HttpErrorStatus } from "@n8io/baseline-http";
import type { FooError } from "../index.ts";

// Every foo error's HTTP status. A new FooError fails type-checking here until it is mapped.
export const fooErrorStatus = {
	FooForbidden: 403,
	FooNameTaken: 409,
	FooNotFound: 404,
} as const satisfies HttpErrorStatus<FooError>;
