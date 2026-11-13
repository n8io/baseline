import { describe, expect, it } from "vitest";
import { connectionsOpen } from "./connections.ts";

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
