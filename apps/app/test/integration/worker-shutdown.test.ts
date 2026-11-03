import { afterEach, describe, expect, inject, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import { httpStatus, workerStart } from "./production-server.ts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("worker shutdown on SIGTERM", { timeout: 30_000 }, () => {
	it("stops an idle worker, closes /readyz and exits 0", async () => {
		const { databaseUrl, drop } = await integrationDatabaseCreate();
		cleanups.push(drop);
		const worker = await workerStart({
			cacheUrl: inject("integrationCacheUrl"),
			databaseUrl,
		});
		cleanups.push(worker.stop);

		worker.child.kill("SIGTERM");

		expect(await worker.exited).toBe(0);
		expect(await httpStatus(worker.healthPort, "/readyz")).toBeUndefined();
	});
});
