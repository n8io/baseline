import { idCreate } from "@n8io/baseline-id";
import { err, ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { FooNameTakenError, FooNotFoundError } from "../foo-errors.ts";
import { type Foo, FooListInput } from "../models/foo.ts";
import type {
	FooReadRepository,
	FooTransaction,
	FooTransactionPorts,
} from "../ports.ts";

export type FooRepositoryContractPorts = {
	fooReadRepository: FooReadRepository;
	fooTransaction: FooTransaction;
};

const fooBuild = (overrides: Partial<Foo> = {}): Foo => {
	const now = new Date("2026-01-01T00:00:00.000Z");
	return {
		archivedAt: null,
		createdAt: now,
		createdBy: "user-1",
		id: idCreate("foo"),
		name: `Foo ${idCreate("foo")}`,
		updatedAt: now,
		...overrides,
	};
};

// Runs against every FooRepository adapter: memory in unit tests, Postgres in integration.
// `create` gives each test empty ports.
export const fooRepositoryContract = (
	create: () => Promise<FooRepositoryContractPorts>,
): void => {
	const insert = async (
		{ fooTransaction }: FooRepositoryContractPorts,
		foo: Foo,
	): Promise<void> => {
		const result = await fooTransaction(({ fooRepository }) =>
			fooRepository.insert(foo),
		);
		expect(result).toEqual(ok(foo));
	};

	describe("transactions", () => {
		it("commits on ok", async () => {
			const ports = await create();
			const foo = fooBuild();
			await insert(ports, foo);
			expect(await ports.fooReadRepository.findById(foo.id)).toEqual(foo);
		});

		it("rolls back on err", async () => {
			const ports = await create();
			const foo = fooBuild();
			const result = await ports.fooTransaction(async ({ fooRepository }) => {
				await fooRepository.insert(foo);
				return err("stop");
			});
			expect(result).toEqual(err("stop"));
			expect(await ports.fooReadRepository.findById(foo.id)).toBeUndefined();
		});

		it("rolls back on a throw", async () => {
			const ports = await create();
			const foo = fooBuild();
			await expect(
				ports.fooTransaction(async ({ fooRepository }) => {
					await fooRepository.insert(foo);
					throw new Error("boom");
				}),
			).rejects.toThrow("boom");
			expect(await ports.fooReadRepository.findById(foo.id)).toBeUndefined();
		});

		it("refuses ports used after the transaction ended", async () => {
			const ports = await create();
			let leaked: FooTransactionPorts | undefined;
			await ports.fooTransaction(async (transactionPorts) => {
				leaked = transactionPorts;
				return ok(undefined);
			});
			await expect(async () =>
				leaked?.fooRepository.findById(idCreate("foo")),
			).rejects.toThrow("after");
			// piece-start: queue
			await expect(async () =>
				leaked?.fooEvents.publish({
					data: { fooId: idCreate("foo") },
					key: idCreate("foo"),
					name: "foo.created",
				}),
			).rejects.toThrow("after");
			// piece-end: queue
		});

		// piece-start: queue
		it("skips a repeated inbox and commits nothing", async () => {
			const ports = await create();
			const inbox = { consumer: "bar.foo-created", eventId: "event-1" };
			const first = fooBuild();
			const repeat = fooBuild();
			for (const foo of [first, repeat]) {
				// Explicit type arguments take an inbox too.
				const result = await ports.fooTransaction<void, FooNameTakenError>(
					async ({ fooRepository }) => {
						const inserted = await fooRepository.insert(foo);
						return inserted.ok ? ok(undefined) : inserted;
					},
					inbox,
				);
				expect(result).toEqual(ok(undefined));
			}
			expect(await ports.fooReadRepository.findById(first.id)).toEqual(first);
			expect(await ports.fooReadRepository.findById(repeat.id)).toBeUndefined();
		});
		// piece-end: queue
	});

	describe("names", () => {
		it("refuses a taken name on insert and update", async () => {
			const ports = await create();
			const alpha = fooBuild({ name: "Alpha" });
			const beta = fooBuild({ name: "Beta" });
			await insert(ports, alpha);
			await insert(ports, beta);
			expect(
				await ports.fooTransaction(({ fooRepository }) =>
					fooRepository.insert(fooBuild({ name: "Alpha" })),
				),
			).toEqual(err(expect.any(FooNameTakenError)));
			expect(
				await ports.fooTransaction(({ fooRepository }) =>
					fooRepository.update({ ...beta, name: "Alpha" }),
				),
			).toEqual(err(expect.any(FooNameTakenError)));
			expect(await ports.fooReadRepository.findById(beta.id)).toEqual(beta);
		});

		it("lets one of two concurrent inserts of a name win", async () => {
			const ports = await create();
			const results = await Promise.all(
				[fooBuild({ name: "Same" }), fooBuild({ name: "Same" })].map((foo) =>
					ports.fooTransaction(({ fooRepository }) =>
						fooRepository.insert(foo),
					),
				),
			);
			expect(results.filter((result) => result.ok)).toHaveLength(1);
			expect(results.filter((result) => !result.ok)).toEqual([
				err(expect.any(FooNameTakenError)),
			]);
		});

		it("updates and deletes", async () => {
			const ports = await create();
			const foo = fooBuild();
			await insert(ports, foo);
			const renamed = { ...foo, name: "Renamed" };
			expect(
				await ports.fooTransaction(({ fooRepository }) =>
					fooRepository.update(renamed),
				),
			).toEqual(ok(renamed));
			expect(await ports.fooReadRepository.findById(foo.id)).toEqual(renamed);
			expect(
				await ports.fooTransaction(({ fooRepository }) =>
					fooRepository.delete(foo.id),
				),
			).toEqual(ok(undefined));
			expect(await ports.fooReadRepository.findById(foo.id)).toBeUndefined();
		});
	});

	describe("missing rows", () => {
		it("reads a foo for update like findById", async () => {
			const ports = await create();
			const foo = fooBuild();
			await insert(ports, foo);
			expect(
				await ports.fooTransaction(async ({ fooRepository }) =>
					ok([
						await fooRepository.findByIdForUpdate(foo.id),
						await fooRepository.findByIdForUpdate(idCreate("foo")),
					]),
				),
			).toEqual(ok([foo, undefined]));
		});

		// A row deleted by a concurrent transaction since it was read looks the same.
		it("answers FooNotFoundError to an update or delete of a missing foo", async () => {
			const ports = await create();
			const missing = fooBuild();
			expect(
				await ports.fooTransaction(({ fooRepository }) =>
					fooRepository.update(missing),
				),
			).toEqual(err(new FooNotFoundError(missing.id)));
			expect(
				await ports.fooTransaction(({ fooRepository }) =>
					fooRepository.delete(missing.id),
				),
			).toEqual(err(new FooNotFoundError(missing.id)));
			expect(
				await ports.fooReadRepository.findById(missing.id),
			).toBeUndefined();
		});
	});

	describe("list", () => {
		const day = (n: number): Date => new Date(Date.UTC(2026, 0, n, 0, 0, 0, 0));
		const seed = async (ports: FooRepositoryContractPorts): Promise<Foo[]> => {
			const foos = ["Delta", "Alpha", "Charlie", "Bravo", "Echo"].map(
				(name, index) => fooBuild({ createdAt: day(index + 1), name }),
			);
			for (const foo of foos) await insert(ports, foo);
			await insert(
				ports,
				fooBuild({ archivedAt: day(9), createdAt: day(9), name: "Old" }),
			);
			return foos;
		};
		const names = (items: Foo[]): string[] => items.map((foo) => foo.name);

		it("pages in sort order until nextCursor is null", async () => {
			const ports = await create();
			await seed(ports);
			const seen: string[] = [];
			let cursor: string | undefined;
			do {
				const page = await ports.fooReadRepository.list(
					FooListInput.parse({ cursor, limit: 2, sort: "name" }),
				);
				seen.push(...names(page.items));
				cursor = page.nextCursor ?? undefined;
				expect(page.total).toBeUndefined();
			} while (cursor);
			expect(seen).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
		});

		it("reads a cursor from another sort, or a mangled one, as the first page", async () => {
			const ports = await create();
			await seed(ports);
			const page = (sort: "createdAt" | "-name", cursor?: string) =>
				ports.fooReadRepository.list(
					FooListInput.parse({ cursor, limit: 2, sort }),
				);
			const byName = await page("-name");
			const byDate = await page("createdAt");
			const mangled = Buffer.from(
				JSON.stringify({ id: byDate.items[0]?.id, kind: "date", value: "x" }),
			).toString("base64url");
			expect(byName.nextCursor).not.toBeNull();
			expect(byDate.nextCursor).not.toBeNull();

			// A name is no instant, but an instant is a fine name, and ahead of "-name" order: both
			// directions matter.
			expect(
				names((await page("createdAt", byName.nextCursor ?? "")).items),
			).toEqual(names(byDate.items));
			expect(
				names((await page("-name", byDate.nextCursor ?? "")).items),
			).toEqual(names(byName.items));
			expect(names((await page("createdAt", mangled)).items)).toEqual(
				names(byDate.items),
			);
			expect(names((await page("createdAt", "nonsense")).items)).toEqual(
				names(byDate.items),
			);
		});

		it("sorts descending and counts on request", async () => {
			const ports = await create();
			await seed(ports);
			const byName = await ports.fooReadRepository.list(
				FooListInput.parse({ count: true, limit: 3, sort: "-name" }),
			);
			expect(names(byName.items)).toEqual(["Echo", "Delta", "Charlie"]);
			expect(byName.total).toBe(5);
			const newest = await ports.fooReadRepository.list(
				FooListInput.parse({ limit: 5 }),
			);
			expect(names(newest.items)).toEqual([
				"Echo",
				"Bravo",
				"Charlie",
				"Alpha",
				"Delta",
			]);
			expect(newest.nextCursor).toBeNull();
		});

		it("lists archived foos only when asked", async () => {
			const ports = await create();
			await seed(ports);
			const archived = await ports.fooReadRepository.list(
				FooListInput.parse({ archived: true, count: true }),
			);
			expect(names(archived.items)).toEqual(["Old"]);
			expect(archived.total).toBe(1);
		});
	});

	// domain-create-start: schedule
	it("archives every unarchived foo updated before the cutoff", async () => {
		const ports = await create();
		const before = new Date("2026-02-01T00:00:00.000Z");
		const now = new Date("2026-03-03T00:00:00.000Z");
		const stale = fooBuild({ updatedAt: new Date("2026-01-31T00:00:00.000Z") });
		const fresh = fooBuild({ updatedAt: before });
		const archived = fooBuild({
			archivedAt: new Date("2026-01-15T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		});
		for (const foo of [stale, fresh, archived]) await insert(ports, foo);
		expect(
			await ports.fooTransaction(async ({ fooRepository }) =>
				ok(await fooRepository.archiveStale(before, now)),
			),
		).toEqual(ok(1));
		expect(await ports.fooReadRepository.findById(stale.id)).toEqual({
			...stale,
			archivedAt: now,
		});
		expect(await ports.fooReadRepository.findById(fresh.id)).toEqual(fresh);
		expect(await ports.fooReadRepository.findById(archived.id)).toEqual(
			archived,
		);
	});
	// domain-create-end: schedule
};
