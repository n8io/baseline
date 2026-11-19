import type { Events } from "@n8io/baseline-queue";
import { describe, expect, it } from "vitest";
import { connectionsOpen } from "../../../../connections.ts";
import { contextsCreate } from "../../../../use-cases.ts";

// The queue piece owns this file.
describe("fooPortsCreate with the queue", () => {
	it("refuses a memory database with real Events", async () => {
		const connections = await connectionsOpen({ role: "publisher" });
		expect(() =>
			contextsCreate({ ...connections, events: {} as Events }),
		).toThrow("both be real or both memory");
	});
});
