import {
	configDefaults,
	defineConfig,
	type TestProjectConfiguration,
} from "vitest/config";

const integration: TestProjectConfiguration = {
	extends: true,
	test: {
		env: { APP_ENV: "test" },
		include: [
			"src/**/*.{postgres,redis}.test.ts",
			"test/integration/**/*.test.ts",
		],
		globalSetup: ["test/integration/global-setup.ts"],
		// A guard, not the fix: DROP DATABASE forces a Postgres checkpoint, and one took 8.4 s on a
		// CI runner, past the 10 s default. Files drop their databases in parallel so they share one.
		// `await using` teardown runs inside the test instead, so those files give each test 60 s (structure.test.ts holds that).
		hookTimeout: 30_000,
		// The files mostly wait on Servers they spawn and on Postgres, so they need few CPUs. Vitest's
		// default (CPUs minus one) runs them one at a time on a 2-CPU CI runner: 182 s against the
		// old 3 min budget, and 83 s with four at once.
		maxWorkers: 4,
		name: "integration",
		setupFiles: ["varlock/auto-load"],
	},
};

export default defineConfig({
	test: {
		expect: { requireAssertions: true },
		// CI runs `pnpm test --changed <base>`: only the tests whose imports reach a changed file. A change
		// to one of these reaches every test, so it runs them all.
		forceRerunTriggers: [
			...configDefaults.forceRerunTriggers,
			"**/.env.schema",
			"**/.env.test",
			"**/.node-version",
			"**/pnpm-lock.yaml",
			"**/pnpm-workspace.yaml",
			"**/tsconfig.json",
		],
		projects: [
			{
				extends: true,
				test: {
					// Unit tests run on memory adapters even where the shell exports real URLs.
					env: {
						APP_ENV: "test",
						CACHE_URL: "memory://",
						DATABASE_URL: "memory://",
					},
					exclude: [
						"src/**/*.{postgres,redis}.test.ts",
						"src/contexts/**/*.test.ts",
					],
					// The same slow import in a beforeAll: it took over 10 s on a busy CI runner.
					hookTimeout: 20_000,
					include: ["*.test.ts", "scripts/*.test.ts", "src/**/*.test.ts"],
					name: "unit",
					// Loads .env.schema and .env.test into process.env in every worker.
					setupFiles: ["varlock/auto-load"],
					// Some tests import server.ts or spawn node; CI runs them beside every package's tests.
					testTimeout: 20_000,
				},
			},
			{
				extends: true,
				test: {
					// Every context test opens connections: keep analytics and error tracking local too.
					env: {
						APP_ENV: "test",
						CACHE_URL: "memory://",
						DATABASE_URL: "memory://",
						MIXPANEL_TOKEN: "",
						SENTRY_DSN: "",
					},
					exclude: ["src/**/*.{postgres,redis}.test.ts"],
					hookTimeout: 20_000,
					include: ["src/contexts/**/*.test.ts"],
					// Domain tests run on memory adapters and share no module state, so one module graph
					// per worker is safe. Isolating each file cost ~96 s on a CI runner (six Domains),
					// past the unit job's 2 min budget; without it they take a few seconds.
					isolate: false,
					name: "unit-contexts",
					setupFiles: ["varlock/auto-load"],
					testTimeout: 20_000,
				},
			},
			integration,
		],
	},
});
