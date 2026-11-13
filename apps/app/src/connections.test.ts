import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionsOpen } from "./connections.ts";

afterEach(() => {
	vi.doUnmock("varlock/env");
	vi.resetModules();
});

// connections.ts under a real database URL. The pool connects on first use, so nothing is dialed.
const databaseOpenWith = async (env: { DATABASE_POOL_MAX?: number }) => {
	const { ENV } =
		await vi.importActual<typeof import("varlock/env")>("varlock/env");
	vi.resetModules();
	vi.doMock("varlock/env", () => ({
		ENV: { ...ENV, ...env, DATABASE_URL: "postgres://localhost/app" },
	}));
	const { databaseOpen } = await import("./connections.ts");
	return async (role: "publisher" | "worker") => {
		const database = databaseOpen(role);
		if (database === "memory") throw new Error("expected a pool");
		await using pgPool = database;
		return pgPool.options.max;
	};
};

describe("connectionsOpen", () => {
	it("opens memory connections for memory:// with nothing to close", async () => {
		const connections = await connectionsOpen({ role: "publisher" });

		expect(connections.database).toBe("memory");
		expect(connections.resources).toEqual([]);
	});

	it("refuses a memory database for the Worker", async () => {
		await expect(connectionsOpen({ role: "worker" })).rejects.toThrow(
			"The worker needs a real database",
		);
	});
});

describe("connectionsOpen with a real database", () => {
	it("asks Postgres first and fails while it is unreachable, so the process never reports ready", async () => {
		const { ENV } =
			await vi.importActual<typeof import("varlock/env")>("varlock/env");
		vi.resetModules();
		vi.doMock("varlock/env", () => ({
			ENV: { ...ENV, DATABASE_URL: "postgres://localhost/app" },
		}));
		const { default: pg } = await import("pg");
		const unreachable = new Error("connect ECONNREFUSED");
		const query = vi
			.spyOn(pg.Pool.prototype, "query")
			.mockImplementation(() => Promise.reject(unreachable));
		const { connectionsOpen: open } = await import("./connections.ts");

		await expect(open({ role: "publisher" })).rejects.toBe(unreachable);

		// The check itself, before the queue or anything else is opened on the pool.
		expect(query.mock.calls).toEqual([["SELECT 1"]]);
		query.mockRestore();
	});
});

describe("databaseOpen", () => {
	it("sizes the pool at 10 for the Server and 5 for the Worker", async () => {
		const poolMax = await databaseOpenWith({});

		expect(await poolMax("publisher")).toBe(10);
		expect(await poolMax("worker")).toBe(5);
	});

	it("sizes the pool from DATABASE_POOL_MAX for the Server and the Worker", async () => {
		const poolMax = await databaseOpenWith({ DATABASE_POOL_MAX: 3 });

		expect(await poolMax("publisher")).toBe(3);
		expect(await poolMax("worker")).toBe(3);
	});
});
