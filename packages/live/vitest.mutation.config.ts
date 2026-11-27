import { defineConfig, mergeConfig } from "vitest/config";
import { vitestShared } from "../../vitest.shared.ts";

// Stryker runs the unit tests only: the Redis ones need Docker and the mutated files are not theirs.
export default mergeConfig(
	vitestShared,
	defineConfig({
		test: {
			exclude: ["src/**/*.redis.test.ts"],
			include: ["src/**/*.test.ts"],
		},
	}),
);
