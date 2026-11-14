import type { Actor } from "@n8io/baseline-authn";
import { type PostgresPool, postgresPoolCreate } from "@n8io/baseline-postgres";
import { postgresTestInterleave } from "@n8io/baseline-postgres/testing";
import { queueCreate, queueEventsCreate } from "@n8io/baseline-queue";
import { err, ok } from "@n8io/baseline-result";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "../../../../test/integration/integration-database.ts";
import { clockMemoryCreate } from "../../../clock.ts";
import { FooNotFoundError } from "../foo-errors.ts";
import type { Foo } from "../models/foo.ts";
import type { FooPorts, FooTransaction } from "../ports.ts";
import { fooPortsMemoryCreate } from "../spi/foo-ports.memory.ts";
import { fooRepositoryPostgresCreate } from "../spi/foo-repository.postgres.ts";
import { fooTransactionPostgresCreate } from "../spi/foo-transaction.postgres.ts";
import { fooCreate } from "./foo-create.ts";
import { fooDelete } from "./foo-delete.ts";
import { fooStaleArchive } from "./foo-stale-archive.ts";
import { fooUpdate } from "./foo-update.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const now = new Date("2026-06-01T00:00:00.000Z");
const closes: (() => Promise<void>)[] = [];
let pgPool: PostgresPool;
let fooTransaction: FooTransaction;

beforeAll(async () => {
	const { databaseUrl, drop } = await integrationDatabaseCreate();
	pgPool = postgresPoolCreate({ databaseUrl, max: 4 });
	closes.push(() => pgPool.end(), drop);
	// piece-start: queue
	const queue = await queueCreate({ pgPool, role: "publisher" });
	closes.unshift(() => queue.stop());
	// piece-end: queue
	fooTransaction = fooTransactionPostgresCreate(
		pgPool,
		// piece-start: queue
		queueEventsCreate(queue),
		// piece-end: queue
	);
});

afterAll(async () => {
	for (const close of closes) await close();
});

const portsCreate = (): FooPorts => ({
	...fooPortsMemoryCreate().ports,
	fooClock: clockMemoryCreate(now),
	fooReadRepository: fooRepositoryPostgresCreate(drizzle({ client: pgPool })),
	fooTransaction,
});

// The same transaction, except it waits on `pause` right after findByIdForUpdate returns: the row
// is read (and locked) and nothing is written yet.
const fooTransactionPausedCreate =
	(transaction: FooTransaction, pause: () => Promise<void>): FooTransaction =>
	(work) =>
		transaction((ports) =>
			work({
				...ports,
				fooRepository: {
					...ports.fooRepository,
					findByIdForUpdate: async (id) => {
						const foo = await ports.fooRepository.findByIdForUpdate(id);
						await pause();
						return foo;
					},
				},
			}),
		);

const fooStaleCreate = async (ports: FooPorts, name: string): Promise<Foo> => {
	const created = await fooCreate({
		...ports,
		fooClock: clockMemoryCreate(new Date(now.getTime() - 60 * 86_400_000)),
	})(owner, { name });
	if (!created.ok) throw created.error;
	return created.value;
};

// These force the interleaving with postgresTestInterleave. Remove `.for("update")` from
// findByIdForUpdate in spi/foo-repository.postgres.ts and each must fail.
describe("Foo writes on Postgres under concurrency", () => {
	// domain-create-start: schedule
	it("is not undone by a stale archive that runs between its read and its write", async () => {
		const ports = portsCreate();
		const foo = await fooStaleCreate(ports, "Stale then renamed");

		const run = await postgresTestInterleave({
			first: (pause) =>
				fooUpdate({
					...ports,
					fooTransaction: fooTransactionPausedCreate(
						ports.fooTransaction,
						pause,
					),
				})(owner, { fooId: foo.id, name: "Renamed" }),
			pgPool,
			second: () => fooStaleArchive(ports)(owner),
		});

		// The archive waited for the rename to commit, and then the foo was no longer stale.
		expect(run.second).toEqual(ok(0));
		expect(run.first.ok).toBe(true);
		expect(run.secondWaited).toBe(true);
		expect(await ports.fooReadRepository.findById(foo.id)).toEqual({
			...foo,
			name: "Renamed",
			updatedAt: now,
		});
	});
	// domain-create-end: schedule

	it("answers FooNotFoundError when a delete holds the row first", async () => {
		const ports = portsCreate();
		const foo = await fooStaleCreate(ports, "Deleted while renamed");

		const run = await postgresTestInterleave({
			first: (pause) =>
				fooDelete({
					...ports,
					fooTransaction: fooTransactionPausedCreate(
						ports.fooTransaction,
						pause,
					),
				})(owner, { fooId: foo.id }),
			pgPool,
			second: () =>
				fooUpdate(ports)(owner, { fooId: foo.id, name: "Too late" }),
		});

		expect(run.second).toEqual(err(new FooNotFoundError(foo.id)));
		expect(run.first).toEqual(ok(undefined));
		expect(run.secondWaited).toBe(true);
		expect(await ports.fooReadRepository.findById(foo.id)).toBeUndefined();
	});
});
