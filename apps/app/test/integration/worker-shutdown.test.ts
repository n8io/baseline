import { describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import {
	productionServerHttpStatus,
	productionServerWorkerStart,
} from "./production-server.ts";

describe("worker shutdown on SIGTERM", { timeout: 60_000 }, () => {
	it("stops an idle worker, closes /readyz and exits 0", async () => {
		await using database = await integrationDatabaseCreate();
		await using worker = await productionServerWorkerStart({
			databaseUrl: database.databaseUrl,
		});

		worker.child.kill("SIGTERM");

		expect(await worker.exited).toBe(0);
		expect(
			await productionServerHttpStatus(worker.healthPort, "/readyz"),
		).toBeUndefined();
	});
});
