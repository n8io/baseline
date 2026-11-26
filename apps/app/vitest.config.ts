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
			"test/integration/**/*.test.{ts,tsx}",
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

// A real browser against the production build on memory adapters: no Docker. `pnpm test:e2e` builds first.
const e2e: TestProjectConfiguration = {
	extends: true,
	test: {
		hookTimeout: 60_000,
		include: ["test/e2e/**/*.test.ts"],
		name: "e2e",
		setupFiles: ["varlock/auto-load"],
		testTimeout: 30_000,
	},
};

// Unit tests run on memory adapters even where the shell exports real URLs, and every one that
// opens connections keeps analytics, error tracking and feature flags local.
const unitEnv = {
	APP_ENV: "test",
	CACHE_URL: "memory://",
	DATABASE_URL: "memory://",
	LAUNCHDARKLY_CLIENT_SIDE_ID: "",
	LAUNCHDARKLY_SDK_KEY: "",
	MIXPANEL_TOKEN: "",
	SENTRY_DSN: "",
} as const;

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
					env: unitEnv,
					exclude: [
						"src/**/*.{postgres,redis}.test.ts",
						"src/contexts/**/*.test.{ts,tsx}",
					],
					// The same slow import in a beforeAll: it took over 10 s on a busy CI runner.
					hookTimeout: 20_000,
					include: [
						"*.test.{ts,tsx}",
						"scripts/*.test.ts",
						"src/**/*.test.{ts,tsx}",
					],
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
					env: unitEnv,
					exclude: ["src/**/*.{postgres,redis}.test.ts"],
					hookTimeout: 20_000,
					include: ["src/contexts/**/*.test.{ts,tsx}"],
					// Context tests run on memory adapters and share no module state, so one module graph
					// per worker is safe. Isolating each file cost ~96 s on a CI runner (six bounded contexts),
					// past the unit job's 2 min budget; without it they take a few seconds.
					isolate: false,
					name: "unit-contexts",
					setupFiles: ["varlock/auto-load"],
					testTimeout: 20_000,
				},
			},
			integration,
			e2e,
		],
	},
});
