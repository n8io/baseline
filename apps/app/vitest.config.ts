import { defineConfig, type TestProjectConfiguration } from "vitest/config";

const integration: TestProjectConfiguration = {
	extends: true,
	test: {
		env: { APP_ENV: "test" },
		include: [
			"src/**/*.{postgres,redis}.test.ts",
			"test/integration/**/*.test.ts",
		],
		globalSetup: ["test/integration/global-setup.ts"],
		name: "integration",
		setupFiles: ["varlock/auto-load"],
	},
};

export default defineConfig({
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: true,
				test: {
					env: { APP_ENV: "test" },
					exclude: ["src/**/*.{postgres,redis}.test.ts"],
					include: ["*.test.ts", "scripts/*.test.ts", "src/**/*.test.ts"],
					name: "unit",
					// Loads .env.schema and .env.test into process.env in every worker.
					setupFiles: ["varlock/auto-load"],
					// Some tests import server.ts or spawn node; CI runs them beside every package's tests.
					testTimeout: 20_000,
				},
			},
			integration,
		],
	},
});
