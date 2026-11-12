import { defineConfig, mergeConfig } from "vitest/config";
import { vitestProjectsCreate, vitestShared } from "../../vitest.shared.ts";

export default mergeConfig(
	vitestShared,
	defineConfig({
		test: {
			projects: vitestProjectsCreate("redis", {
				globalSetup: ["../../test/redis/redis-global-setup.ts"],
				hookTimeout: 30_000,
			}),
		},
	}),
);
