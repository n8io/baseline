import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, inject, it, onTestFinished } from "vitest";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import { postgresMigrate } from "./index.ts";
import { postgresMigrateLockKey } from "./postgres-migrate.ts";

const migrationsFolder = fileURLToPath(
	new URL("postgres-test-migrations", import.meta.url),
);

// pg_locks splits a bigint advisory key into classid (high 32 bits) and objid (low 32 bits).
const key = BigInt.asUintN(64, BigInt(postgresMigrateLockKey));
const classid = String(key >> 32n);
const objid = String(key & 0xffff_ffffn);

const query = async <R extends pg.QueryResultRow>(
	databaseUrl: string,
	text: string,
): Promise<R[]> => {
	const pgClient = new pg.Client({ connectionString: databaseUrl });
	await pgClient.connect();
	try {
		return (await pgClient.query<R>(text)).rows;
	} finally {
		await pgClient.end();
	}
};

const lockStates = async (databaseUrl: string): Promise<boolean[]> =>
	(
		await query<{ granted: boolean }>(
			databaseUrl,
			`SELECT granted FROM pg_locks WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database()) AND classid = ${classid} AND objid = ${objid} ORDER BY granted DESC`,
		)
	).map((row) => row.granted);

const until = async (check: () => Promise<boolean>): Promise<void> => {
	const deadline = Date.now() + 5_000;
	while (!(await check())) {
		if (Date.now() > deadline) {
			throw new Error("Timed out waiting");
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
};

const applied = async (databaseUrl: string): Promise<string[]> =>
	(
		await query<{ name: string }>(
			databaseUrl,
			"SELECT name FROM drizzle.__drizzle_migrations",
		)
	).map((row) => row.name);

const docker = (...args: string[]): string =>
	execFileSync("docker", args, { encoding: "utf8", stdio: "pipe" }).trim();

// PgBouncer in front of the test database, removed when the test ends. Returns its URL.
const pgbouncerStart = async (
	databaseUrl: string,
	poolMode: "session" | "transaction",
): Promise<string> => {
	const name = `baseline-pgbouncer-test-${process.pid}-${poolMode}`;
	const upstream = new URL(databaseUrl);
	upstream.host = `${docker(
		"inspect",
		"--format",
		"{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
		inject("postgresContainer"),
	)}:5432`;
	docker(
		"run",
		"--detach",
		"--rm",
		"--name",
		name,
		"--env",
		`DATABASE_URL=${upstream}`,
		"--env",
		`POOL_MODE=${poolMode}`,
		"--env",
		"AUTH_TYPE=scram-sha-256",
		"--publish",
		"127.0.0.1::5432",
		// Like the Postgres container, it ends by itself when teardown never runs.
		"--entrypoint",
		"timeout",
		"edoburu/pgbouncer:v1.26.1-p0",
		"300",
		"/entrypoint.sh",
		"/usr/bin/pgbouncer",
		"/etc/pgbouncer/pgbouncer.ini",
	);
	onTestFinished(() => {
		docker("rm", "--force", "--volumes", name);
	});
	const url = new URL(databaseUrl);
	url.host = docker("port", name, "5432/tcp").split("\n")[0] ?? "";
	await until(async () => {
		try {
			await query(url.toString(), "SELECT 1");
			return true;
		} catch {
			return false;
		}
	});
	return url.toString();
};

describe("postgresMigrate", () => {
	it("refuses a URL that is not postgres:// or postgresql://", async () => {
		await expect(
			postgresMigrate({ databaseUrl: "memory://", migrationsFolder }),
		).rejects.toThrow(
			new TypeError(
				'Invalid database URL: found "memory://"; use postgres:// or postgresql://',
			),
		);
	});

	it("applies pending migrations, then finds nothing on a rerun", async () => {
		const databaseUrl = await postgresTestDatabaseCreate();

		await postgresMigrate({ databaseUrl, migrationsFolder });
		await postgresMigrate({ databaseUrl, migrationsFolder });

		expect(await applied(databaseUrl)).toEqual(["20261102000000_foo_create"]);
		expect(await query(databaseUrl, "SELECT * FROM foo.foo")).toEqual([]);
		expect(await lockStates(databaseUrl)).toEqual([]);
	});

	it("holds the advisory lock, so a concurrent run waits and then finds nothing", async () => {
		const databaseUrl = await postgresTestDatabaseCreate();

		const first = postgresMigrate({ databaseUrl, migrationsFolder });
		await until(async () => (await lockStates(databaseUrl)).length === 1);
		const second = postgresMigrate({ databaseUrl, migrationsFolder });
		await until(async () => (await lockStates(databaseUrl)).length === 2);

		expect(await lockStates(databaseUrl)).toEqual([true, false]);
		await Promise.all([first, second]);
		expect(await applied(databaseUrl)).toEqual(["20261102000000_foo_create"]);
		expect(await lockStates(databaseUrl)).toEqual([]);
	});

	it("applies each migration once across 12 concurrent runs", async () => {
		const databaseUrl = await postgresTestDatabaseCreate();

		await Promise.all(
			Array.from({ length: 12 }, () =>
				postgresMigrate({ databaseUrl, migrationsFolder }),
			),
		);

		expect(await applied(databaseUrl)).toEqual(["20261102000000_foo_create"]);
		expect(await lockStates(databaseUrl)).toEqual([]);
	});

	it("gives up after lockWaitMs while another session holds the lock, naming the lock", async () => {
		const databaseUrl = await postgresTestDatabaseCreate();
		const holder = new pg.Client({ connectionString: databaseUrl });
		await holder.connect();
		onTestFinished(() => holder.end());
		await holder.query("SELECT pg_advisory_lock($1::bigint)", [
			postgresMigrateLockKey,
		]);

		await expect(
			postgresMigrate({ databaseUrl, lockWaitMs: 300, migrationsFolder }),
		).rejects.toThrow(
			`postgresMigrate waited 300 ms for the migrate lock (advisory lock ${postgresMigrateLockKey}) and gave up: another migrate is still running, or one that ran through a connection pooler left the lock on a pooled connection. Find the holder in pg_locks (locktype 'advisory') and end that session`,
		);
		expect(await lockStates(databaseUrl)).toEqual([true]);
		expect(
			await query(databaseUrl, "SELECT to_regclass('foo.foo') AS foo"),
		).toEqual([{ foo: null }]);
	});

	it.each([0, -1, 1.5])("refuses lockWaitMs %s", async (lockWaitMs) => {
		await expect(
			postgresMigrate({
				databaseUrl: "postgres://localhost/db",
				lockWaitMs,
				migrationsFolder,
			}),
		).rejects.toThrow(new TypeError("lockWaitMs must be a positive integer"));
	});

	it.each(["transaction", "session"] as const)(
		"refuses to run through a connection pooler in %s mode, leaving no lock behind",
		async (poolMode) => {
			const databaseUrl = await postgresTestDatabaseCreate();
			const pooledUrl = await pgbouncerStart(databaseUrl, poolMode);

			await expect(
				postgresMigrate({ databaseUrl: pooledUrl, migrationsFolder }),
			).rejects.toThrow(
				"postgresMigrate needs a direct connection to Postgres: databaseUrl goes through a connection pooler, which can hand the migrate lock to another session and keep it after this run ends. Use a URL that reaches Postgres itself",
			);
			expect(await lockStates(databaseUrl)).toEqual([]);
			expect(
				await query(databaseUrl, "SELECT to_regclass('foo.foo') AS foo"),
			).toEqual([{ foo: null }]);
		},
		// Room to pull the PgBouncer image on a cold machine.
		120_000,
	);
});
