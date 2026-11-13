import type { Events } from "@n8io/baseline-queue";
import { describe, expect, it } from "vitest";
import { ENV } from "#env";
import { connectionsOpen } from "../../../connections.ts";
import { fooPortsCreate } from "./index.ts";

// The queue piece owns this file.
describe("fooPortsCreate with the queue", () => {
	it("refuses a memory database with real Events", async () => {
		const connections = await connectionsOpen(ENV, "publisher");
		expect(() =>
			fooPortsCreate({ ...connections, events: {} as Events }),
		).toThrow("both be real or both memory");
	});
});
