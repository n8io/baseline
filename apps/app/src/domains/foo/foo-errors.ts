import type { Id } from "@n8io/baseline-id";

export class FooNotFoundError extends Error {
	readonly type = "FooNotFound";
	readonly fooId: Id<"foo">;
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

// No fooId when the Actor may not create a foo at all.
export class FooForbiddenError extends Error {
	readonly type = "FooForbidden";
	readonly fooId: Id<"foo"> | null;
	constructor(fooId?: Id<"foo"> | null) {
		super(fooId ? `Not allowed to change foo ${fooId}` : "Not allowed");
		this.fooId = fooId ?? null;
	}
}

export type FooError = FooNotFoundError | FooNameTakenError | FooForbiddenError;
