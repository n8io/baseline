import type { Id } from "@n8io/baseline-id";
import type { Inbox } from "@n8io/baseline-queue";
import type { Result } from "@n8io/baseline-result";
import type { FooNameTakenError } from "./foo-errors.ts";
import type { Foo, FooEventMap, FooList, FooListInput } from "./models/foo.ts";

export type FooReadRepository = {
	findById(id: Id<"foo">): Promise<Foo | undefined>;
	list(input: FooListInput): Promise<FooList>;
};

// Writes happen only through this, and only fooTransaction hands it out.
export type FooRepository = FooReadRepository & {
	insert(foo: Foo): Promise<Result<Foo, FooNameTakenError>>;
	update(foo: Foo): Promise<Result<Foo, FooNameTakenError>>;
	delete(id: Id<"foo">): Promise<void>;
	// Archives every foo with updatedAt < before and archivedAt null; returns how many.
	archiveStale(before: Date, now: Date): Promise<number>;
};

// piece-start: queue
export type FooEvents = {
	publish<K extends keyof FooEventMap>(
		name: K,
		data: FooEventMap[K],
	): Promise<void>;
};
// piece-end: queue

// No fooTransaction here: transactions do not nest.
export type FooTransactionPorts = {
	fooRepository: FooRepository;
	// piece-start: queue
	fooEvents: FooEvents;
	// piece-end: queue
};

// Commits when the work returns ok, rolls back on err or a throw.
export type FooTransaction = {
	<T, E>(
		work: (ports: FooTransactionPorts) => Promise<Result<T, E>>,
	): Promise<Result<T, E>>;
	// piece-start: queue
	// With an inbox, a repeat skips the work and returns ok.
	<E>(
		work: (ports: FooTransactionPorts) => Promise<Result<void, E>>,
		inbox: Inbox,
	): Promise<Result<void, E>>;
	// piece-end: queue
};

// piece-start: cache
export type FooCache = {
	get(id: Id<"foo">): Promise<Foo | undefined>;
	set(foo: Foo): Promise<void>;
	delete(id: Id<"foo">): Promise<void>;
};
// piece-end: cache

// piece-start: live
export type FooLiveUpdates = {
	send(update: {
		type: "foo.updated" | "foo.deleted";
		id: Id<"foo">;
	}): Promise<void>;
};
// piece-end: live

export type FooPorts = {
	fooReadRepository: FooReadRepository;
	fooTransaction: FooTransaction;
	// piece-start: cache
	fooCache: FooCache;
	// piece-end: cache
	// piece-start: live
	fooLiveUpdates: FooLiveUpdates;
	// piece-end: live
};
