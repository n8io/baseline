import type { Id } from "@n8io/baseline-id";
import { err, ok } from "@n8io/baseline-result";
import { cursorDecode, cursorMemoryPage } from "../../../../cursor.ts";
import { FooNameTakenError, FooNotFoundError } from "../../domain/errors.ts";
import type { Foo, FooListInput } from "../../domain/foo.ts";
import type { FooRepository } from "../../domain/repositories.ts";

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
		// model-create-start: schedule
		archiveStale: async (before, now) => {
			const stale = [...state.foos.values()].filter(
				(foo) => foo.archivedAt === null && foo.updatedAt < before,
			);
			for (const foo of stale) {
				state.foos.set(foo.id, { ...foo, archivedAt: new Date(now) });
			}
			return stale.length;
		},
		// model-create-end: schedule
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
