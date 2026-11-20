import { describe, expect, it } from "vitest";
import { connectionsOpen, databaseOpen } from "./connections.ts";

// A pool connects on first use, so nothing is dialed.
const poolMax = async ({
	poolMax,
	role,
}: {
	poolMax?: number;
	role: "publisher" | "worker";
}) => {
	const database = databaseOpen({
		poolMax: poolMax ?? null,
		role,
		url: "postgres://localhost/app",
	});
	if (database === "memory") throw new Error("expected a pool");
	await using pgPool = database;
	return pgPool.options.max;
};

describe("connectionsOpen", () => {
	it("opens memory connections for memory:// with nothing to close", async () => {
		const connections = await connectionsOpen({ role: "publisher" });

		expect(connections.database).toBe("memory");
		expect(connections.resources).toEqual([]);
	});

	it("refuses a memory database for the Worker", async () => {
		await expect(connectionsOpen({ role: "worker" })).rejects.toThrow(
			"The Worker needs a real database",
		);
	});

	it("opens the database named in urls instead of DATABASE_URL, and fails while it is unreachable", async () => {
		// Nothing listens on port 1; DATABASE_URL is memory:// here, so only urls can cause this.
		await expect(
			connectionsOpen({
				role: "publisher",
				urls: { database: "postgres://baseline:baseline@127.0.0.1:1/baseline" },
			}),
		).rejects.toThrow("ECONNREFUSED");
	});

	it("keeps DATABASE_URL for a field urls leaves out", async () => {
		const connections = await connectionsOpen({
			role: "publisher",
			urls: { cache: null },
		});

		expect(connections.database).toBe("memory");
	});
});

describe("databaseOpen", () => {
	it("sizes the pool at 10 for the Server and 5 for the Worker", async () => {
		expect(await poolMax({ role: "publisher" })).toBe(10);
		expect(await poolMax({ role: "worker" })).toBe(5);
	});

	it("sizes the pool from poolMax for the Server and the Worker", async () => {
		expect(await poolMax({ poolMax: 3, role: "publisher" })).toBe(3);
		expect(await poolMax({ poolMax: 3, role: "worker" })).toBe(3);
	});
});
