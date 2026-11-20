import { type Id, idToUuid } from "@n8io/baseline-id";
import type { Bar } from "../../domain/bar.ts";
import type { BarRepository } from "../../domain/repositories.ts";

// Copies in and out, like Postgres, so no caller shares a row.
export const barRepositoryMemoryCreate = (state: {
	bars: Map<Id<"bar">, Bar>;
}): BarRepository => ({
	deleteByFooId: async (fooId) => {
		let deleted = 0;
		for (const bar of [...state.bars.values()]) {
			if (bar.fooId !== fooId) continue;
			state.bars.delete(bar.id);
			deleted += 1;
		}
		return deleted;
	},
	insert: async (bar) => {
		if (state.bars.has(bar.id)) {
			throw new Error(`Bar ${bar.id} already exists`);
		}
		state.bars.set(bar.id, structuredClone(bar));
	},
	listByFooId: async (fooId) =>
		[...state.bars.values()]
			.filter((bar) => bar.fooId === fooId)
			// Ties go by id as Postgres compares the uuid, so both adapters list in one order.
			.sort(
				(a, b) =>
					a.createdAt.getTime() - b.createdAt.getTime() ||
					(idToUuid(a.id) < idToUuid(b.id) ? -1 : 1),
			)
			.map((bar) => structuredClone(bar)),
});
