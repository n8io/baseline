import { idCreate } from "@n8io/baseline-id";
import { liveHubMemoryCreate } from "@n8io/baseline-live";
import type { Queue } from "@n8io/baseline-queue";
import { ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { fooPortsCreate } from "./index.ts";

describe("fooPortsCreate", () => {
	it("builds memory ports for a memory database", async () => {
		const ports = fooPortsCreate({
			// piece-start: cache
			cache: "memory",
			// piece-end: cache
			database: "memory",
			// piece-start: live
			liveHub: liveHubMemoryCreate(),
			// piece-end: live
			// piece-start: queue
			queue: "memory",
			// piece-end: queue
		});
		const now = new Date();
		const foo = {
			archivedAt: null,
			createdAt: now,
			createdBy: "u1",
			id: idCreate("foo"),
			name: "alpha",
			updatedAt: now,
		};
		await ports.fooTransaction(async ({ fooRepository }) => {
			await fooRepository.insert(foo);
			return ok(undefined);
		});
		expect(await ports.fooReadRepository.findById(foo.id)).toEqual(foo);
	});

	// piece-start: queue
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
	// piece-end: queue
});
