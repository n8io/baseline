import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";

const freePort = async (): Promise<number> => {
	const server = createServer().listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	server.close();
	if (address === null || typeof address === "string")
		throw new Error("no port");
	return address.port;
};

type Worker = {
	child: ChildProcess;
	exited: Promise<number | null>;
	stderr: () => string;
};

const workerStart = (env: Record<string, string>): Worker => {
	const child = spawn(
		"node",
		["--import", "varlock/auto-load", "src/worker.ts"],
		{
			env: { ...process.env, APP_ENV: "test", CACHE_URL: "memory://", ...env },
			stdio: ["ignore", "ignore", "pipe"],
		},
	);
	let stderr = "";
	child.stderr?.on("data", (chunk) => {
		stderr += String(chunk);
	});
	const exited = once(child, "exit").then(([code]) => code as number | null);
	return { child, exited, stderr: () => stderr };
};

// Resolves once /readyz answers 200, i.e. the worker finished registering.
const workerReady = async (
	worker: Worker,
	healthPort: number,
): Promise<void> => {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		if (worker.child.exitCode !== null) {
			throw new Error(`worker exited early: ${worker.stderr()}`);
		}
		const res = await fetch(`http://127.0.0.1:${healthPort}/readyz`).catch(
			() => undefined,
		);
		if (res?.status === 200) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("worker never became ready");
};

const scheduled = async (
	databaseUrl: string,
): Promise<{ name: string; cron: string }[]> => {
	const pgClient = new pg.Client({ connectionString: databaseUrl });
	await pgClient.connect();
	try {
		const { rows } = await pgClient.query<{ name: string; cron: string }>(
			"SELECT name, cron FROM queue.schedule WHERE name NOT LIKE 'queue.%' ORDER BY name",
		);
		return rows;
	} finally {
		await pgClient.end();
	}
};

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const databaseCreate = async (): Promise<string> => {
	const { databaseUrl, drop } = await integrationDatabaseCreate();
	cleanups.push(drop);
	return databaseUrl;
};

const workerStop = async (worker: Worker): Promise<void> => {
	if (worker.child.exitCode === null) {
		worker.child.kill("SIGTERM");
		await worker.exited;
	}
};

const workerBoot = async (databaseUrl: string, schedule?: string) => {
	const healthPort = await freePort();
	const worker = workerStart({
		DATABASE_URL: databaseUrl,
		HEALTH_PORT: String(healthPort),
		...(schedule === undefined ? {} : { SCHEDULE_FOO_STALE_ARCHIVE: schedule }),
	});
	cleanups.push(() => workerStop(worker));
	return { healthPort, worker };
};

describe("worker schedules", () => {
	it("registers foo.stale-archive with its own cron", async () => {
		const databaseUrl = await databaseCreate();
		const { healthPort, worker } = await workerBoot(databaseUrl);
		await workerReady(worker, healthPort);
		expect(await scheduled(databaseUrl)).toEqual([
			{ cron: "0 3 * * *", name: "foo.stale-archive" },
		]);
	});

	it("takes the cron from SCHEDULE_FOO_STALE_ARCHIVE", async () => {
		const databaseUrl = await databaseCreate();
		const { healthPort, worker } = await workerBoot(databaseUrl, "*/5 * * * *");
		await workerReady(worker, healthPort);
		expect(await scheduled(databaseUrl)).toEqual([
			{ cron: "*/5 * * * *", name: "foo.stale-archive" },
		]);
	});

	it("unschedules foo.stale-archive when SCHEDULE_FOO_STALE_ARCHIVE=off", async () => {
		const databaseUrl = await databaseCreate();
		const first = await workerBoot(databaseUrl);
		await workerReady(first.worker, first.healthPort);
		expect(await scheduled(databaseUrl)).toHaveLength(1);
		await workerStop(first.worker);

		const { healthPort, worker } = await workerBoot(databaseUrl, "off");
		await workerReady(worker, healthPort);
		expect(await scheduled(databaseUrl)).toEqual([]);
	});

	it("fails boot naming SCHEDULE_FOO_STALE_ARCHIVE when its cron is bad", async () => {
		const databaseUrl = await databaseCreate();
		const { worker } = await workerBoot(databaseUrl, "every day");
		expect(await worker.exited).toBe(1);
		expect(worker.stderr()).toContain(
			"Invalid cron for SCHEDULE_FOO_STALE_ARCHIVE",
		);
		expect(await scheduled(databaseUrl)).toEqual([]);
	});
});
