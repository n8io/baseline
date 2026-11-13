import { describe, expect, it } from "vitest";
import {
	httpStatus,
	productionServerWaitFor,
	workerSpawn,
} from "./production-server.ts";

describe("worker readiness", { timeout: 60_000 }, () => {
	it("never answers /readyz 200 and exits 1 while Postgres is unreachable", async () => {
		await using worker = await workerSpawn({
			// Nothing listens on port 1.
			databaseUrl: "postgres://baseline:baseline@127.0.0.1:1/baseline",
		});
		const statuses = new Set<number | undefined>();
		await productionServerWaitFor({
			what: "the exit",
			check: async () => {
				statuses.add(await httpStatus(worker.healthPort, "/readyz"));
				return worker.child.exitCode !== null;
			},
			timeoutMs: 30_000,
		});

		expect(await worker.exited).toBe(1);
		expect(statuses).not.toContain(200);
		expect(worker.stderr()).toContain("ECONNREFUSED");
	});
});
