import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { afterEach, describe, expect, inject, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import {
	type OtlpSpan,
	otlpEnv,
	otlpReceiverStart,
	spanAncestors,
	spanAttribute,
	waitFor,
	workerStart,
} from "./production-server.ts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const pgConnect = async (databaseUrl: string): Promise<pg.Client> => {
	const pgClient = new pg.Client({ connectionString: databaseUrl });
	await pgClient.connect();
	cleanups.push(() => pgClient.end());
	return pgClient;
};

// Queues one foo.stale-archive job the way a cron tick would, through pg-boss itself (a
// dependency of @n8io/baseline-queue, not of the app).
const staleArchiveSend = async (databaseUrl: string): Promise<void> => {
	const fromQueue = createRequire(import.meta.resolve("@n8io/baseline-queue"));
	const { PgBoss } = (await import(
		pathToFileURL(fromQueue.resolve("pg-boss")).href
	)) as {
		PgBoss: new (
			options: Record<string, unknown>,
		) => {
			send(name: string, data: null): Promise<unknown>;
			start(): Promise<unknown>;
			stop(options: { graceful: boolean }): Promise<void>;
		};
	};
	const boss = new PgBoss({
		connectionString: databaseUrl,
		migrate: false,
		schedule: false,
		schema: "queue",
		supervise: false,
	});
	await boss.start();
	await boss.send("foo.stale-archive", null);
	await boss.stop({ graceful: false });
};

const httpStatus = async (port: number, path: string) => {
	const res = await fetch(`http://127.0.0.1:${port}${path}`).catch(
		() => undefined,
	);
	await res?.body?.cancel();
	return res?.status;
};

describe("worker shutdown on SIGTERM", { timeout: 30_000 }, () => {
	it("finishes the job in flight, answers /readyz 503 and exits 0", async () => {
		const receiver = await otlpReceiverStart();
		cleanups.push(receiver.close);
		const { databaseUrl, drop } = await integrationDatabaseCreate();
		cleanups.push(drop);
		const db = await pgConnect(databaseUrl);
		await db.query(
			`INSERT INTO foo.foo (id, name, created_by, created_at, updated_at)
			 VALUES (gen_random_uuid(), 'Stale', 'dev-admin', now() - interval '40 days', now() - interval '40 days')`,
		);
		const worker = await workerStart({
			cacheUrl: inject("integrationCacheUrl"),
			databaseUrl,
			env: otlpEnv(receiver),
		});
		cleanups.push(worker.stop);

		// A lock that blocks the archive's UPDATE keeps the job running until the test lets go.
		const locker = await pgConnect(databaseUrl);
		await locker.query("BEGIN");
		await locker.query("LOCK TABLE foo.foo IN SHARE MODE");
		await staleArchiveSend(databaseUrl);
		await waitFor("the archive UPDATE waiting on the lock", async () => {
			const { rows } = await db.query(
				`SELECT 1 FROM pg_stat_activity
				 WHERE wait_event_type = 'Lock' AND query ILIKE 'update "foo"."foo"%'`,
			);
			return rows.length === 1;
		});

		worker.child.kill("SIGTERM");
		await waitFor(
			"/readyz 503",
			async () => (await httpStatus(worker.healthPort, "/readyz")) === 503,
		);
		expect(worker.child.exitCode).toBeNull();
		await locker.query("COMMIT");

		expect(await worker.exited).toBe(0);
		const { rows: foos } = await db.query(
			"SELECT archived_at IS NOT NULL AS archived FROM foo.foo",
		);
		expect(foos).toEqual([{ archived: true }]);
		const { rows: jobs } = await db.query(
			"SELECT state FROM queue.job WHERE name = 'foo.stale-archive'",
		);
		expect(jobs).toEqual([{ state: "completed" }]);

		// The native-TS worker exports its use case span with pg spans under it (V15).
		const spans = receiver.spans();
		const useCase = spans.find((span) => span.name === "fooStaleArchive");
		expect(useCase).toBeDefined();
		expect(
			spans.some(
				(span) =>
					spanAttribute(span, "db.system.name") === "postgresql" &&
					spanAncestors(span, spans).includes(useCase as OtlpSpan),
			),
		).toBe(true);
	});
});
