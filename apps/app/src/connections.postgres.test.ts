import { describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "../test/integration/integration-database.ts";
import { connectionsOpen } from "./connections.ts";

// `await using` drops the database inside the test: a checkpoint can take longer than the 5 s default.
describe("connectionsOpen with urls", { timeout: 60_000 }, () => {
	it("opens a real database while the cache stays in memory", async () => {
		await using database = await integrationDatabaseCreate();
		const connections = await connectionsOpen({
			role: "publisher",
			urls: { cache: "memory://", database: database.databaseUrl },
		});

		try {
			expect(connections.database).not.toBe("memory");
			if (connections.database === "memory") return;
			const { rows } = await connections.database.query("SELECT 1 AS one");
			expect(rows).toEqual([{ one: 1 }]);
		} finally {
			for (const step of [...connections.intakes, ...connections.resources]) {
				await step.close();
			}
		}
	});
});
