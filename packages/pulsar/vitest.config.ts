import { defineConfig, mergeConfig } from "vitest/config";
import { vitestProjectsCreate, vitestShared } from "../../vitest.shared.ts";

export default mergeConfig(
	vitestShared,
	defineConfig({
		test: {
			projects: vitestProjectsCreate("pulsar", {
				globalSetup: [
					"../../test/postgres/postgres-global-setup.ts",
					"./src/pulsar-global-setup.ts",
				],
				hookTimeout: 180_000,
				testTimeout: 60_000,
			}),
		},
	}),
);
