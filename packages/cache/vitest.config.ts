import { defineConfig, mergeConfig } from "vitest/config";
import { vitestShared } from "../../vitest.shared.ts";

export default mergeConfig(
	vitestShared,
	defineConfig({
		test: {
			globalSetup: ["test/redis-global-setup.ts"],
			hookTimeout: 30_000,
		},
	}),
);
