import type { Id } from "@n8io/baseline-id";
import { err, ok } from "@n8io/baseline-result";
import { cursorDecode, cursorMemoryPage } from "../../../cursor.ts";
import { FooNameTakenError, FooNotFoundError } from "../foo-errors.ts";
import type { Foo, FooEventMap, FooListInput } from "../models/foo.ts";
import type { FooRepository } from "../ports.ts";

// Committed foos. The read repository and the transaction share one state object; a
// transaction swaps in its copy of `foos` on commit.
export type FooMemoryState = {
	foos: Map<Id<"foo">, Foo>;
	// piece-start: queue
	inbox: Set<string>;
	// Events reach it only on commit.
	published: { name: keyof FooEventMap; data: unknown; key: string }[];
	// piece-end: queue
};

export const fooMemoryStateCreate = (): FooMemoryState => ({
	foos: new Map(),
	// piece-start: queue
	inbox: new Set(),
	published: [],
	// piece-end: queue
});

// Like Postgres: the unique index on name, and copies in and out so no caller shares a row.
export const fooRepositoryMemoryCreate = (state: {
	foos: Map<Id<"foo">, Foo>;
}): FooRepository => {
	const nameTaken = (foo: Foo): boolean =>
		[...state.foos.values()].some(
			(other) => other.name === foo.name && other.id !== foo.id,
		);

	const findById = async (id: Id<"foo">): Promise<Foo | undefined> => {
		const foo = state.foos.get(id);
		return foo && structuredClone(foo);
	};

	return {
		// domain-create-start: schedule
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
		// domain-create-end: schedule
		delete: async (id) =>
			state.foos.delete(id) ? ok(undefined) : err(new FooNotFoundError(id)),
		findById,
		// Memory transactions run one at a time, so the plain read already holds the row.
		findByIdForUpdate: findById,
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
			const kind = field === "name" ? "text" : "date";
			const after = input.cursor
				? cursorDecode({ cursor: input.cursor, kind, prefix: "foo" })
				: null;
			const matching = [...state.foos.values()].filter(
				(foo) => (foo.archivedAt !== null) === input.archived,
			);
			const page = cursorMemoryPage({
				after,
				descending: input.sort.startsWith("-"),
				items: matching,
				kind,
				limit: input.limit,
				sortValue: (foo) =>
					field === "name" ? foo.name : foo.createdAt.toISOString(),
			});
			const items = page.items.map((foo) => structuredClone(foo));
			return input.count
				? { items, nextCursor: page.nextCursor, total: matching.length }
				: { items, nextCursor: page.nextCursor };
		},
		update: async (foo) => {
			if (!state.foos.has(foo.id)) return err(new FooNotFoundError(foo.id));
			if (nameTaken(foo)) return err(new FooNameTakenError(foo.name));
			state.foos.set(foo.id, structuredClone(foo));
			return ok(structuredClone(foo));
		},
	};
};
