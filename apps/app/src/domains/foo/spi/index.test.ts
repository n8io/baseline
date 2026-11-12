import { liveHubMemoryCreate } from "@n8io/baseline-live";
import type { Queue } from "@n8io/baseline-queue";
import { describe, expect, it } from "vitest";
import { fooPortsCreate } from "./index.ts";

describe("fooPortsCreate", () => {
	it("refuses a memory database with a real queue", () => {
		const queue: Queue = { isAlive: () => true, stop: async () => undefined };
		expect(() =>
			fooPortsCreate({
				// piece-start: cache
				cache: "memory",
				// piece-end: cache
				database: "memory",
				// piece-start: live
				liveHub: liveHubMemoryCreate(),
				// piece-end: live
				queue,
			}),
		).toThrow("both be Postgres or both memory");
	});
});
