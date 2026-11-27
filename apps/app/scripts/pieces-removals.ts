// What removing each Piece does: its paths, env lines, package.json edits and refusals.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type Manifest,
	manifestEdit,
	recordOmit,
	textEdit,
} from "./pieces-manifest.ts";
import type { Piece } from "./pieces-names.ts";
import { uiEdit } from "./pieces-removals-ui.ts";
import { piecesRemovedFind, trackedFiles } from "./pieces-signs.ts";

type PieceRemoval = {
	// Paths from the Project root, deleted when present.
	paths: string[];
	// Files under src/ deleted by name.
	srcFiles?: RegExp;
	// Edits files that cannot carry markers (env files, JSON, scripts).
	edit?: (directory: string) => void;
	// Why it cannot go yet, if it cannot.
	refusal?: (directory: string) => string | undefined;
};

// Env files carry no markers: CACHE_URL and the comment lines above it.
const cacheUrlLines = /^(#.*\n)*CACHE_URL=.*\n/m;
// MIXPANEL_TOKEN, its comment and its decorators.
const mixpanelTokenLines = /^(# Mixpanel.*\n)?(# @.*\n)*MIXPANEL_TOKEN=.*\n/m;
// SENTRY_DSN, its comment and its decorators.
const sentryDsnLines = /^(# Sentry.*\n)?(# @.*\n)*SENTRY_DSN=.*\n/m;
// LAUNCHDARKLY_SDK_KEY, its comment and its decorators.
const launchDarklySdkKeyLines =
	/^(# LaunchDarkly.*\n)?(# @.*\n)*LAUNCHDARKLY_SDK_KEY=.*\n/m;
// LAUNCHDARKLY_CLIENT_SIDE_ID, its comment and its decorators.
const launchDarklyClientSideIdLines =
	/^(# LaunchDarkly.*\n)?(# @.*\n)*LAUNCHDARKLY_CLIENT_SIDE_ID=.*\n/m;
// The SCHEDULE_* overrides and the marker model-create adds them at; model-create drops
// them from a new context the same way.
export const pieceScheduleLines =
	/^# schedule overrides.*\n((# @.*\n)?SCHEDULE_.*\n|# wiring: schedules\n)*/m;
// REDIS_HOST_PORT and its decorator.
const redisHostPortLines =
	/^# @type=port @sensitive=false\nREDIS_HOST_PORT=.*\n/m;
// The part of the `dev` script the queue removal edits (structure.test.ts holds it to it).
export const pieceDevWorker =
	/\(varlock run -- sh -c 'HEALTH_PORT=\$\(\(HEALTH_PORT \+ 1\)\) exec node --watch --import \.\/src\/preload\.ts src\/worker\.ts' & ([^)]*)\)/;

export const pieceRemovals: Record<Piece, PieceRemoval> = {
	analytics: {
		edit: (directory) => {
			for (const env of ["schema", "production"]) {
				textEdit({
					directory,
					path: `.env.${env}`,
					edit: (text) => text.replace(mixpanelTokenLines, ""),
				});
			}
		},
		paths: ["src/analytics-open.ts", "src/analytics-open.test.ts"],
		srcFiles: /-use-cases-analytics\.test\.ts$/,
	},
	"api-reference": {
		paths: [
			"src/api-reference.ts",
			"src/api-reference.test.ts",
			"test/e2e/api-reference-smoke.test.ts",
			"test/integration/api-reference.test.ts",
		],
	},
	cache: {
		paths: ["src/cache-store-open.ts", "src/cache-store-open.test.ts"],
		srcFiles:
			/(\/adapters\/outbound\/[^/]*-cache(d|(\.[a-z]+)*)\.ts|-use-cases-cache\.test\.ts)$/,
	},
	"error-tracking": {
		edit: (directory) => {
			for (const env of ["schema", "production"]) {
				textEdit({
					directory,
					path: `.env.${env}`,
					edit: (text) => text.replace(sentryDsnLines, ""),
				});
			}
		},
		paths: ["src/error-tracking-open.ts", "src/error-tracking-open.test.ts"],
	},
	"feature-flags": {
		edit: (directory) => {
			for (const env of ["schema", "production"]) {
				textEdit({
					directory,
					path: `.env.${env}`,
					edit: (text) =>
						text
							.replace(launchDarklySdkKeyLines, "")
							.replace(launchDarklyClientSideIdLines, ""),
				});
			}
		},
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
			"test/e2e/feature-flags-smoke.test.ts",
			"test/integration/feature-flags-config.test.ts",
		],
	},
	live: {
		paths: ["src/live-hub-open.ts", "test/e2e/live-smoke.test.ts"],
		srcFiles: /-live(-routes)?(\.test)?\.ts$/,
	},
	queue: {
		edit: (directory) => {
			textEdit({
				directory,
				path: ".env.schema",
				edit: (text) => text.replace(pieceScheduleLines, ""),
			});
			manifestEdit(directory, (manifest) => ({
				...manifest,
				scripts: {
					...(recordOmit(manifest.scripts, [
						"blocked-keys",
					]) as Manifest["scripts"]),
					dev: manifest.scripts["dev"]?.replace(pieceDevWorker, "$1"),
				},
			}));
		},
		paths: [
			"src/blocked-keys.ts",
			"src/events-open.ts",
			"src/queue-open.ts",
			"src/worker.ts",
			"test/integration/blocked-keys.test.ts",
			"test/integration/worker-ready.test.ts",
			"test/integration/worker-shutdown.test.ts",
		],
		refusal: (directory) =>
			trackedFiles(directory).some(
				(path) =>
					path.startsWith("src/") &&
					!/\.test\.tsx?$/.test(path) &&
					readFileSync(join(directory, path), "utf8").includes(
						"queueConsumerCreate",
					),
			)
				? "Remove your Event handlers first: they run only in the Worker."
				: undefined,
		srcFiles:
			/(\/adapters\/inbound\/[^/]*-schedule(\.test)?\.ts|\/adapters\/outbound\/[^/]*-transaction\.postgres\.test\.ts|-queue\.test\.ts)$/,
	},
	redis: {
		edit: (directory) => {
			for (const env of ["schema", "development", "production", "test"]) {
				textEdit({
					directory,
					path: `.env.${env}`,
					edit: (text) => text.replace(cacheUrlLines, ""),
				});
			}
			textEdit({
				directory,
				path: ".env.schema",
				edit: (text) => text.replace(redisHostPortLines, ""),
			});
		},
		paths: ["src/redis-open.ts"],
		refusal: (directory) => {
			const removed = piecesRemovedFind(directory);
			return removed.includes("cache") && removed.includes("live")
				? undefined
				: "Remove the cache and live updates first: both run on Redis.";
		},
	},
	cli: {
		paths: ["clients/cli", "test/integration/foo-cli.test.ts"],
	},
	sdk: {
		edit: (directory) =>
			manifestEdit(directory, (manifest) => ({
				...manifest,
				scripts: recordOmit(manifest.scripts, [
					"sdk-generate",
				]) as Manifest["scripts"],
			})),
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
		refusal: (directory) =>
			existsSync(join(directory, "clients/cli/package.json"))
				? "Remove the cli first: it runs on the SDK."
				: undefined,
	},
	ui: {
		edit: uiEdit,
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
			"test/e2e/ui-flows.test.ts",
			"test/e2e/ui-smoke.test.ts",
			"test/integration/rollout.test.ts",
		],
	},
};
