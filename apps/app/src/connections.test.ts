import { describe, expect, it } from "vitest";
import { ENV } from "#env";
import { connectionsOpen } from "./connections.ts";

describe("connectionsOpen", () => {
	it("opens memory connections for memory:// with nothing to close", async () => {
		const connections = await connectionsOpen(ENV, "publisher");

		expect(connections.database).toBe("memory");
		expect(connections.resources).toEqual([]);
	});

	it("refuses a memory database for the Worker", async () => {
		await expect(connectionsOpen(ENV, "worker")).rejects.toThrow(
			"The worker needs a real database",
		);
	});
});
