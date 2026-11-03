import { describe, expect, it } from "vitest";
import { mutationTargets } from "../../../scripts/test-mutation.ts";

describe("mutationTargets", () => {
	it("mutates changed source files that unit tests can cover", () => {
		expect(
			mutationTargets([
				"src/domains/bar/use-cases/bar-create.ts",
				"src/domains/bar/spi/bar-repository.memory.ts",
				"src/domains/bar/spi/bar-cache.memory.ts",
				"src/ui/routes/bar-list.tsx",
				"src/bridges/bar-baz.ts",
				"",
			]),
		).toEqual([
			"src/domains/bar/use-cases/bar-create.ts",
			"src/domains/bar/spi/bar-repository.memory.ts",
			"src/domains/bar/spi/bar-cache.memory.ts",
			"src/ui/routes/bar-list.tsx",
			"src/bridges/bar-baz.ts",
		]);
	});

	it("skips tests, contracts, generated types and files only integration tests cover", () => {
		expect(
			mutationTargets([
				"src/domains/bar/use-cases/bar-create.test.ts",
				"src/domains/bar/spi/bar-repository.contract.ts",
				"src/env.d.ts",
				"src/domains/bar/spi/bar-repository.postgres.ts",
				"src/domains/bar/spi/bar-transaction.postgres.ts",
				"src/domains/bar/spi/bar-cache.redis.ts",
				"src/domains/bar/spi/bar-table.ts",
				"src/server.ts",
				"src/worker.ts",
				"src/seed.ts",
				"src/ui/routes.ts",
				"src/ui/context.ts",
				"src/ui/app.css",
			]),
		).toEqual([]);
	});
});
