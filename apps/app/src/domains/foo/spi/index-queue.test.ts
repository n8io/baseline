import type { Queue } from "@n8io/baseline-queue";
import { describe, expect, it } from "vitest";
import { ENV } from "#env";
import { connectionsOpen } from "../../../connections.ts";
import { fooPortsCreate } from "./index.ts";

// The queue piece owns this file.
describe("fooPortsCreate with the queue", () => {
	it("refuses a memory database with a real queue", async () => {
		const queue: Queue = { isAlive: () => true, stop: async () => undefined };
		const connections = await connectionsOpen(ENV, "publisher");
		expect(() => fooPortsCreate({ ...connections, queue })).toThrow(
			"both be Postgres or both memory",
		);
	});
});
