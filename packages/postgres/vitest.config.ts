import { defineConfig, mergeConfig } from "vitest/config";
import { vitestProjectsCreate, vitestShared } from "../../vitest.shared.ts";

export default mergeConfig(
	vitestShared,
	defineConfig({
		test: {
			projects: vitestProjectsCreate("postgres", {
				globalSetup: ["../../test/postgres/postgres-global-setup.ts"],
				hookTimeout: 30_000,
				testTimeout: 15_000,
			}),
		},
	}),
);
