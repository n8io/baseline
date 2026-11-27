// The Pieces of the stack, one entry each: a Piece's name, packages, order and removal list are
// written here and nowhere else. `pnpm piece-add <name>` (scripts/piece-add.ts) writes an entry
// and its scaffold. Pure data: it imports nothing, so every script can read it without a cycle.

// Env lines a removal deletes from env files, which carry no piece markers. Each regex matches a
// line with the comment above it and its decorators.
type EnvEdit = { envs: readonly string[]; lines: readonly RegExp[] };

// `template` is what the Piece owns in the Template's foo files (scripts/model-create-options.ts):
// the files a new context or Model leaves out once the Piece is removed, and its env line.
export type PieceEntry = {
	// Pieces that must go first, when installed.
	after?: readonly string[];
	// For a Piece that adds no package to the app: the package folder (its package.json) that tells
	// it is there instead. A folder left with only ignored files, such as node_modules, does not.
	folder?: string;
	// The packages it removes; the first one tells it is there, unless the Piece has a folder.
	packages: readonly string[];
	// Env lines the removal deletes, per env file.
	envs?: readonly EnvEdit[];
	// Paths from the Project root, deleted when present.
	paths: readonly string[];
	// package.json scripts the removal drops.
	scripts?: readonly string[];
	// Files under src/ deleted by name.
	srcFiles?: RegExp;
	template?: { lines?: RegExp; paths: readonly RegExp[] };
};

// The MIXPANEL_TOKEN line, its comment and its decorators.
const mixpanelTokenLines = /^(# Mixpanel.*\n)?(# @.*\n)*MIXPANEL_TOKEN=.*\n/m;
// The SENTRY_DSN line, its comment and its decorators.
const sentryDsnLines = /^(# Sentry.*\n)?(# @.*\n)*SENTRY_DSN=.*\n/m;
// The LAUNCHDARKLY_SDK_KEY line, its comment and its decorators.
const launchDarklySdkKeyLines =
	/^(# LaunchDarkly.*\n)?(# @.*\n)*LAUNCHDARKLY_SDK_KEY=.*\n/m;
// The LAUNCHDARKLY_CLIENT_SIDE_ID line, its comment and its decorators.
const launchDarklyClientSideIdLines =
	/^(# LaunchDarkly.*\n)?(# @.*\n)*LAUNCHDARKLY_CLIENT_SIDE_ID=.*\n/m;
// The CACHE_URL line and the comment lines above it.
const cacheUrlLines = /^(#.*\n)*CACHE_URL=.*\n/m;
// The REDIS_HOST_PORT line and its decorator.
const redisHostPortLines =
	/^# @type=port @sensitive=false\nREDIS_HOST_PORT=.*\n/m;
// The SCHEDULE_* overrides and the marker model-create adds them at; model-create drops them from a
// new context the same way.
export const pieceScheduleLines =
	/^# schedule overrides.*\n((# @.*\n)?SCHEDULE_.*\n|# wiring: schedules\n)*/m;

// The entries are in the order the piece checks and the README use. A new entry goes last: pnpm
// piece-add appends one here and its row in the app-ci.yml matrix, which test/app-ci-pieces.test.ts
// holds to this order.
export const pieceManifest = {
	analytics: {
		envs: [{ envs: ["schema", "production"], lines: [mixpanelTokenLines] }],
		packages: ["@n8io/baseline-analytics"],
		paths: ["src/analytics-open.ts", "src/analytics-open.test.ts"],
		srcFiles: /-use-cases-analytics\.test\.ts$/,
		template: { paths: [/^src\/contexts\/foo\/.*-analytics\.test\.ts$/] },
	},
	"api-reference": {
		packages: ["swagger-ui-dist"],
		paths: [
			"src/api-reference.ts",
			"src/api-reference.test.ts",
			"test/integration/api-reference.test.ts",
		],
	},
	cache: {
		packages: ["@n8io/baseline-cache"],
		paths: ["src/cache-store-open.ts", "src/cache-store-open.test.ts"],
		srcFiles:
			/(\/adapters\/outbound\/[^/]*-cache(d|(\.[a-z]+)*)\.ts|-use-cases-cache\.test\.ts)$/,
		template: { paths: [/^src\/contexts\/foo\/.*-cache(d|\.test)?\.ts$/] },
	},
	"error-tracking": {
		envs: [{ envs: ["schema", "production"], lines: [sentryDsnLines] }],
		packages: ["@n8io/baseline-error-tracking"],
		paths: ["src/error-tracking-open.ts", "src/error-tracking-open.test.ts"],
	},
	"feature-flags": {
		envs: [
			{
				envs: ["schema", "production"],
				lines: [launchDarklySdkKeyLines, launchDarklyClientSideIdLines],
			},
		],
		packages: [
			"@n8io/baseline-feature-flags",
			"@launchdarkly/js-client-sdk",
			"@launchdarkly/node-server-sdk",
			"@launchdarkly/openfeature-node-server",
			"@openfeature/core",
			"@openfeature/launchdarkly-client-provider",
			"@openfeature/server-sdk",
			"@openfeature/web-sdk",
			"happy-dom",
		],
		paths: [
			"src/feature-flags-open.ts",
			"src/feature-flags-open.test.ts",
			"src/flags.ts",
			"src/ui/entry.client.tsx",
			"src/ui/feature-flag-example.tsx",
			"src/ui/feature-flags-config-script.test.tsx",
			"src/ui/feature-flags-config-script.tsx",
			"src/ui/feature-flags-browser.test.tsx",
			"src/ui/feature-flags-browser.tsx",
			"src/ui/feature-flags-client-config.test.ts",
			"src/ui/feature-flags-client-config.ts",
			"src/ui/feature-flags.ts",
			"test/integration/feature-flags-config.test.ts",
		],
	},
	live: {
		packages: ["@n8io/baseline-live"],
		paths: ["src/live-hub-open.ts"],
		srcFiles: /-live(-routes)?(\.test)?\.ts$/,
		template: {
			paths: [/^src\/contexts\/foo\/.*-live(-routes)?(\.test)?\.ts$/],
		},
	},
	queue: {
		envs: [{ envs: ["schema"], lines: [pieceScheduleLines] }],
		packages: ["@n8io/baseline-queue"],
		paths: [
			"src/blocked-keys.ts",
			"src/events-open.ts",
			"src/queue-open.ts",
			"src/worker.ts",
			"test/integration/blocked-keys.test.ts",
			"test/integration/worker-ready.test.ts",
			"test/integration/worker-shutdown.test.ts",
		],
		scripts: ["blocked-keys"],
		srcFiles:
			/(\/adapters\/inbound\/[^/]*-schedule(\.test)?\.ts|\/adapters\/outbound\/[^/]*-transaction\.postgres\.test\.ts|-queue\.test\.ts)$/,
		template: {
			lines: pieceScheduleLines,
			paths: [
				/^src\/worker\.ts$/,
				/^src\/contexts\/foo\/adapters\/inbound\/foo-schedule(\.test)?\.ts$/,
				/^src\/contexts\/foo\/adapters\/outbound\/foo-transaction\.postgres\.test\.ts$/,
				/^src\/contexts\/foo\/.*-queue\.test\.ts$/,
			],
		},
	},
	redis: {
		after: ["cache", "live"],
		envs: [
			{
				envs: ["schema", "development", "production", "test"],
				lines: [cacheUrlLines],
			},
			{ envs: ["schema"], lines: [redisHostPortLines] },
		],
		packages: ["@n8io/baseline-redis"],
		paths: ["src/redis-open.ts"],
	},
	cli: {
		folder: "clients/cli",
		packages: [],
		paths: ["clients/cli", "test/integration/foo-cli.test.ts"],
	},
	sdk: {
		after: ["cli"],
		packages: ["orval"],
		paths: [
			".github/workflows/clients-release.yml",
			"clients/environments.json",
			"clients/sdk",
			"scripts/clients-release-files.ts",
			"scripts/clients-release-npm.ts",
			"scripts/clients-release.test.ts",
			"scripts/clients-release.ts",
			"scripts/sdk-generate.ts",
			"test/integration/foo-sdk.test.ts",
		],
		scripts: ["sdk-generate"],
	},
	ui: {
		packages: [
			"react-router",
			"@react-router/dev",
			"@react-router/node",
			"@tailwindcss/vite",
			"@types/react",
			"@types/react-dom",
			"class-variance-authority",
			"cn",
			// Gone from the Template, but a Project may have added it with a shadcn component.
			"lucide-react",
			"radix-ui",
			"react",
			"react-dom",
			"react-router-hono-server",
			"shadcn",
			"tailwindcss",
		],
		// .react-router holds the types React Router generated; Biome stops skipping it.
		paths: [
			".react-router",
			"src/ui",
			"public",
			"components.json",
			"react-router.config.ts",
			"test/integration/feature-flags-config.test.ts",
			"test/integration/csp-nonce.ts",
			"test/integration/rollout-build.ts",
			"test/integration/rollout.test.ts",
		],
		template: { paths: [/^src\/ui\//] },
	},
	// pnpm piece-add inserts new entries above this line.
} as const satisfies Record<string, PieceEntry>;
