import type { Id, IdOf } from "@n8io/baseline-id";

export class FooNotFoundError extends Error {
	readonly type = "FooNotFound";
	readonly fooId: IdOf<"foo">;
	constructor(fooId: Id<"foo">) {
		super(`Foo ${fooId} not found`);
		this.fooId = fooId;
	}
}

export class FooNameTakenError extends Error {
	readonly type = "FooNameTaken";
	// Not `name`: that would shadow Error.name.
	readonly fooName: string;
	constructor(fooName: string) {
		super(`A foo named ${fooName} already exists`);
		this.fooName = fooName;
	}
}

export class FooForbiddenError extends Error {
	readonly type = "FooForbidden";
	readonly fooId: IdOf<"foo">;
	constructor(fooId: Id<"foo">) {
		super(`Not allowed to change foo ${fooId}`);
		this.fooId = fooId;
	}
}

export type FooError = FooNotFoundError | FooNameTakenError | FooForbiddenError;
