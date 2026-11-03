import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: true,
				test: {
					env: { APP_ENV: "test" },
					exclude: ["src/**/*.{postgres,redis}.test.ts"],
					include: ["src/**/*.test.ts", "test/unit/**/*.test.ts"],
					name: "unit",
					// Loads .env.schema and .env.test into process.env in every worker.
					setupFiles: ["varlock/auto-load"],
				},
			},
			{
				extends: true,
				test: {
					env: { APP_ENV: "test" },
					include: [
						"src/**/*.{postgres,redis}.test.ts",
						"test/integration/**/*.test.ts",
					],
					name: "integration",
					setupFiles: ["varlock/auto-load"],
				},
			},
		],
	},
});
