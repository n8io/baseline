import { describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import { httpStatus, workerStart } from "./production-server.ts";

describe("worker shutdown on SIGTERM", { timeout: 30_000 }, () => {
	it("stops an idle worker, closes /readyz and exits 0", async () => {
		await using database = await integrationDatabaseCreate();
		await using worker = await workerStart({
			databaseUrl: database.databaseUrl,
		});

		worker.child.kill("SIGTERM");

		expect(await worker.exited).toBe(0);
		expect(await httpStatus(worker.healthPort, "/readyz")).toBeUndefined();
	});
});
