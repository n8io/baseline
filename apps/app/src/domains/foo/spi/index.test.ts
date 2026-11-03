import { liveMemory } from "@n8io/baseline-live";
import type { Queue } from "@n8io/baseline-queue";
import { describe, expect, it } from "vitest";
import { fooPortsCreate } from "./index.ts";

describe("fooPortsCreate", () => {
	it("refuses a memory database with a real queue", () => {
		const queue: Queue = { isAlive: () => true, stop: async () => undefined };
		expect(() =>
			fooPortsCreate({
				cache: "memory",
				database: "memory",
				liveHub: liveMemory(),
				queue,
			}),
		).toThrow("both be Postgres or both memory");
	});
});
