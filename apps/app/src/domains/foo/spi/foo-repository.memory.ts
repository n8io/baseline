import type { Id } from "@n8io/baseline-id";
import {
	postgresCursorDecode,
	postgresCursorEncode,
} from "@n8io/baseline-postgres";
import { err, ok } from "@n8io/baseline-result";
import { FooNameTakenError } from "../foo-errors.ts";
import type { Foo, FooListInput } from "../models/foo.ts";
import type { FooRepository } from "../ports.ts";

// Committed foos. The read repository and the transaction share one state object; a
// transaction swaps in its copy of `foos` on commit.
export type FooMemoryState = {
	foos: Map<Id<"foo">, Foo>;
	// piece-start: queue
	inbox: Set<string>;
	// piece-end: queue
};

export const fooMemoryStateCreate = (): FooMemoryState => ({
	foos: new Map(),
	// piece-start: queue
	inbox: new Set(),
	// piece-end: queue
});

// The sort value as the cursor stores it: an ISO string for dates.
const fooSortValue = (foo: Foo, field: "createdAt" | "name"): string =>
	field === "name" ? foo.name : foo.createdAt.toISOString();

// Code-unit order, like Postgres with COLLATE "C".
const fooOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Like Postgres: the unique index on name, and copies in and out so no caller shares a row.
export const fooRepositoryMemoryCreate = (state: {
	foos: Map<Id<"foo">, Foo>;
}): FooRepository => {
	const nameTaken = (foo: Foo): boolean =>
		[...state.foos.values()].some(
			(other) => other.name === foo.name && other.id !== foo.id,
		);

	return {
		archiveStale: async (before, now) => {
			let archived = 0;
			for (const foo of state.foos.values()) {
				if (foo.archivedAt === null && foo.updatedAt < before) {
					foo.archivedAt = new Date(now);
					archived += 1;
				}
			}
			return archived;
		},
		delete: async (id) => {
			state.foos.delete(id);
		},
		findById: async (id) => {
			const foo = state.foos.get(id);
			return foo && structuredClone(foo);
		},
		insert: async (foo) => {
			if (state.foos.has(foo.id)) {
				throw new Error(`Foo ${foo.id} already exists`);
			}
			if (nameTaken(foo)) return err(new FooNameTakenError(foo.name));
			state.foos.set(foo.id, structuredClone(foo));
			return ok(structuredClone(foo));
		},
		list: async (input: FooListInput) => {
			const field = input.sort.replace("-", "") as "createdAt" | "name";
			const direction = input.sort.startsWith("-") ? -1 : 1;
			const compare = (
				a: { k: string; id: string },
				b: { k: string; id: string },
			): number => direction * (fooOrder(a.k, b.k) || fooOrder(a.id, b.id));
			const after = input.cursor
				? postgresCursorDecode(input.cursor, "foo")
				: undefined;

			const matching = [...state.foos.values()]
				.filter((foo) => (foo.archivedAt !== null) === input.archived)
				.map((foo) => ({ foo, id: foo.id, k: fooSortValue(foo, field) }))
				.sort(compare);
			const rest = after
				? matching.filter((row) => compare(row, after) > 0)
				: matching;
			const page = rest.slice(0, input.limit);
			const last = page.at(-1);
			const nextCursor =
				rest.length > input.limit && last
					? postgresCursorEncode({ id: last.id, k: last.k })
					: null;
			const items = page.map((row) => structuredClone(row.foo));
			return input.count
				? { items, nextCursor, total: matching.length }
				: { items, nextCursor };
		},
		update: async (foo) => {
			if (!state.foos.has(foo.id)) {
				throw new Error(`Foo ${foo.id} to update does not exist`);
			}
			if (nameTaken(foo)) return err(new FooNameTakenError(foo.name));
			state.foos.set(foo.id, structuredClone(foo));
			return ok(structuredClone(foo));
		},
	};
};
