import { idCreate, idToUuid } from "@n8io/baseline-id";
import { err, ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import type { FooTransaction } from "../../application/ports.ts";
import type { Bar } from "../../domain/bar.ts";
import type { BarReadRepository } from "../../domain/repositories.ts";

export type BarRepositoryContractPorts = {
	barReadRepository: BarReadRepository;
	fooTransaction: FooTransaction;
};

const barBuild = (overrides: Partial<Bar> = {}): Bar => ({
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	createdBy: "user-1",
	fooId: idCreate("foo"),
	id: idCreate("bar"),
	text: "a note",
	...overrides,
});

// Runs against every BarRepository adapter: memory in unit tests, Postgres in the Postgres tests.
// Each test uses its own fooId, so `create` may hand out ports that hold earlier tests' rows.
export const barRepositoryContract = (
	create: () => Promise<BarRepositoryContractPorts>,
): void => {
	const insert = async (
		{ fooTransaction }: BarRepositoryContractPorts,
		bars: Bar[],
	): Promise<void> => {
		await fooTransaction(async ({ barRepository }) => {
			for (const bar of bars) await barRepository.insert(bar);
			return ok(undefined);
		});
	};

	describe("BarRepository", () => {
		it("lists a foo's bars oldest first, and no other foo's", async () => {
			const ports = await create();
			const fooId = idCreate("foo");
			const later = barBuild({
				createdAt: new Date("2026-01-02T00:00:00.000Z"),
				fooId,
			});
			const earlier = barBuild({ fooId });
			await insert(ports, [later, earlier, barBuild()]);

			expect(await ports.barReadRepository.listByFooId(fooId)).toEqual([
				earlier,
				later,
			]);
		});

		it("lists bars made at the same time by id, as Postgres orders the uuid", async () => {
			const ports = await create();
			const fooId = idCreate("foo");
			const byId = [
				barBuild({ fooId }),
				barBuild({ fooId }),
				barBuild({ fooId }),
			].toSorted((a, b) => (idToUuid(a.id) < idToUuid(b.id) ? -1 : 1));
			// Inserted last id first, so insertion order cannot pass for id order.
			await insert(ports, byId.toReversed());

			expect(await ports.barReadRepository.listByFooId(fooId)).toEqual(byId);
		});

		it("deletes a foo's bars and says how many", async () => {
			const ports = await create();
			const fooId = idCreate("foo");
			const other = barBuild();
			await insert(ports, [barBuild({ fooId }), barBuild({ fooId }), other]);

			const deleted = await ports.fooTransaction(async ({ barRepository }) =>
				ok(await barRepository.deleteByFooId(fooId)),
			);

			expect(deleted).toEqual(ok(2));
			expect(await ports.barReadRepository.listByFooId(fooId)).toEqual([]);
			expect(await ports.barReadRepository.listByFooId(other.fooId)).toEqual([
				other,
			]);
		});

		it("rolls an insert back with the transaction", async () => {
			const ports = await create();
			const bar = barBuild();

			const result = await ports.fooTransaction(async ({ barRepository }) => {
				await barRepository.insert(bar);
				return err("stop");
			});

			expect(result).toEqual(err("stop"));
			expect(await ports.barReadRepository.listByFooId(bar.fooId)).toEqual([]);
		});
	});
};
