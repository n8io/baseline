import { defineConfig, mergeConfig } from "vitest/config";
import { vitestShared } from "../../vitest.shared.ts";

export default mergeConfig(
	vitestShared,
	defineConfig({
		test: {
			globalSetup: ["../../test/postgres/postgres-global-setup.ts"],
			hookTimeout: 60_000,
			testTimeout: 60_000,
		},
	}),
);
