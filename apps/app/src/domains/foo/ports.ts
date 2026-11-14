import type { Id } from "@n8io/baseline-id";
import type { Inbox } from "@n8io/baseline-queue";
import type { Result } from "@n8io/baseline-result";
import type { Clock } from "../../clock.ts";
import type { FooNameTakenError, FooNotFoundError } from "./foo-errors.ts";
import type { Foo, FooEventMap, FooList, FooListInput } from "./models/foo.ts";

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

// No fooTransaction here: transactions do not nest.
export type FooTransactionPorts = {
	fooRepository: FooRepository;
	// piece-start: queue
	fooEvents: {
		// `key` is the Event key: the id of the foo the Event is about.
		publish<K extends keyof FooEventMap>(event: {
			name: K;
			data: FooEventMap[K];
			key: Id<"foo">;
		}): Promise<void>;
	};
	// piece-end: queue
};

// Commits when the work returns ok, rolls back on err or a throw. One signature, so explicit
// type arguments work with an inbox too: fooTransaction<void, never>(work, inbox).
export type FooTransaction = <T, E>(
	work: (ports: FooTransactionPorts) => Promise<Result<T, E>>,
	// piece-start: queue
	// A repeated inbox skips the work and returns ok(undefined), so only work whose value may be
	// undefined takes one.
	inbox?: [undefined] extends [T] ? Inbox | null : null,
	// piece-end: queue
) => Promise<Result<T, E>>;

export type FooPorts = {
	// piece-start: analytics
	// Returns at once and never throws; call it after commit.
	fooAnalytics: {
		track(event: {
			name: "foo.created";
			actorId: string;
			fooId: Id<"foo">;
		}): void;
	};
	// piece-end: analytics
	// piece-start: cache
	// Never throws when the store is down: a get is then a miss. No catch around it.
	fooCache: {
		get(id: Id<"foo">): Promise<Foo | undefined>;
		set(foo: Foo): Promise<void>;
		delete(id: Id<"foo">): Promise<void>;
	};
	// piece-end: cache
	// Every Use case reads the time here, never from new Date().
	fooClock: Clock;
	// piece-start: live
	// Best effort and never throws; call it after commit with no catch.
	fooLiveUpdates: {
		send(update: {
			type: "foo.updated" | "foo.deleted";
			id: Id<"foo">;
		}): Promise<void>;
	};
	// piece-end: live
	fooReadRepository: FooReadRepository;
	fooTransaction: FooTransaction;
};
