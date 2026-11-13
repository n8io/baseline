// pnpm piece-remove <piece>: removes a piece of the stack from this Project (ui, live, cache,
// redis, queue, analytics or error-tracking). It deletes the piece's files and its `piece-start:` to `piece-end:`
// blocks, removes its packages and the imports nothing uses any more, and never commits.
// docs/agents/pieces.md says what each piece is and how to take one back. Running it again after
// a template-upgrade takes out the lines the upgrade brought back.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pieceBlocksRemove, piecesRemovedFind } from "./domain-create.ts";
import { run } from "./template-render.ts";

type PieceRemoval = {
	// The packages it removes; the first one is how domain-create and this script tell it is gone.
	packages: string[];
	// Paths from the Project root, deleted when present.
	paths: string[];
	// Files under src/ deleted by name.
	srcFiles?: RegExp;
	// Edits files that cannot carry markers (env files, JSON, scripts).
	edit?: (directory: string) => void;
	// Why it cannot go yet, if it cannot.
	refusal?: (directory: string) => string | undefined;
};

const textEdit = (
	directory: string,
	path: string,
	edit: (text: string) => string,
) => {
	const file = join(directory, path);
	if (!existsSync(file)) return;
	const text = readFileSync(file, "utf8");
	const edited = edit(text);
	if (edited !== text) writeFileSync(file, edited);
};

type Manifest = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	imports?: Record<string, string>;
	scripts: Partial<Record<string, string>>;
};

const manifestEdit = (directory: string, edit: (m: Manifest) => void) =>
	textEdit(directory, "package.json", (text) => {
		const manifest = JSON.parse(text) as Manifest;
		edit(manifest);
		return `${JSON.stringify(manifest, null, "\t")}\n`;
	});

const packagesInstalled = (directory: string): Set<string> => {
	const manifest = JSON.parse(
		readFileSync(join(directory, "package.json"), "utf8"),
	) as Manifest;
	return new Set(
		Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }),
	);
};

const trackedFiles = (directory: string): string[] =>
	run("git", ["ls-files", "-z"], { cwd: directory })
		.split("\0")
		.filter((p) => p !== "" && existsSync(join(directory, p)));

// Without the pages, Vite builds only src/server.ts.
const apiViteConfig = `import { defineConfig } from "vite";

// Builds src/server.ts into build/server/index.js, one file per source file so import.meta.main
// stays true only there. Every library stays in node_modules so OpenTelemetry can patch it.
export default defineConfig({
	build: {
		outDir: "build/server",
		rollupOptions: {
			output: {
				entryFileNames: (chunk) => (chunk.isEntry ? "index.js" : "[name].js"),
				preserveModules: true,
				preserveModulesRoot: "src",
			},
		},
		ssr: "src/server.ts",
	},
	ssr: { external: true },
});
`;

// Without React Router, src/server.ts serves its Hono app itself.
const apiServeLines = `
// Node runs this file in development and its build in production; tests only import it.
if (import.meta.main) {
	serverServe(serve({ fetch: app.fetch, port: ENV.PORT }, serverListening) as Server);
}
`;
const nodeServerImport = 'import { serve } from "@hono/node-server";\n';

const uiEdit = (directory: string) => {
	textEdit(directory, "biome.json", (text) => {
		const biome = JSON.parse(text) as {
			css?: unknown;
			files: { includes: string[] };
		};
		delete biome.css;
		biome.files.includes = biome.files.includes.filter(
			(p) => p !== "!.react-router",
		);
		return `${JSON.stringify(biome, null, "\t")}\n`;
	});
	writeFileSync(join(directory, "vite.config.ts"), apiViteConfig);
	textEdit(directory, "src/server.ts", (text) =>
		text.includes("serverServe(serve(")
			? text
			: `${text.replace(/^import /m, `${nodeServerImport}import `)}${apiServeLines}`,
	);
	manifestEdit(directory, (manifest) => {
		manifest.scripts.build = "vite build";
		manifest.scripts.check = "varlock codegen && biome check . && tsc --noEmit";
		manifest.scripts.dev = manifest.scripts.dev?.replace(
			"node --import ./src/preload.ts --conditions=development ./node_modules/@react-router/dev/bin.cjs dev",
			"node --watch --import ./src/preload.ts src/server.ts",
		);
		delete manifest.imports?.["#ui/*"];
	});
};

// Env files carry no markers: CACHE_URL and the comment lines above it.
const cacheUrlLines = /^(#.*\n)*CACHE_URL=.*\n/m;
// MIXPANEL_TOKEN, its comment and its decorators.
const mixpanelTokenLines = /^(# Mixpanel.*\n)?(# @.*\n)*MIXPANEL_TOKEN=.*\n/m;
// SENTRY_DSN, its comment and its decorators.
const sentryDsnLines = /^(# Sentry.*\n)?(# @.*\n)*SENTRY_DSN=.*\n/m;
// The SCHEDULE_* overrides and the marker domain-create adds them at.
const scheduleLines =
	/^# schedule overrides.*\n((# @.*\n)?SCHEDULE_.*\n|# domain-create: schedules\n)*/m;
const workerDev =
	/\(HEALTH_PORT=9001 node --watch --import \.\/src\/preload\.ts src\/worker\.ts & ([^)]*)\)/;

export const pieceRemovals: Record<string, PieceRemoval> = {
	analytics: {
		edit: (directory) => {
			for (const env of ["schema", "production"]) {
				textEdit(directory, `.env.${env}`, (text) =>
					text.replace(mixpanelTokenLines, ""),
				);
			}
		},
		packages: ["@n8io/baseline-analytics"],
		paths: ["src/analytics-open.ts", "src/analytics-open.test.ts"],
		srcFiles: /-use-cases-analytics\.test\.ts$/,
	},
	cache: {
		packages: ["@n8io/baseline-cache"],
		paths: ["src/cache-store-open.ts", "src/cache-store-open.test.ts"],
		srcFiles:
			/(\/spi\/[^/]*-cache(d|(\.[a-z]+)*)\.ts|-use-cases-cache\.test\.ts)$/,
	},
	"error-tracking": {
		edit: (directory) => {
			for (const env of ["schema", "production"]) {
				textEdit(directory, `.env.${env}`, (text) =>
					text.replace(sentryDsnLines, ""),
				);
			}
		},
		packages: ["@n8io/baseline-error-tracking"],
		paths: ["src/error-tracking-open.ts", "src/error-tracking-open.test.ts"],
	},
	live: {
		packages: ["@n8io/baseline-live"],
		paths: ["src/live-hub-open.ts"],
		srcFiles: /-live(\.test)?\.ts$/,
	},
	queue: {
		edit: (directory) => {
			textEdit(directory, ".env.schema", (text) =>
				text.replace(scheduleLines, ""),
			);
			manifestEdit(directory, (manifest) => {
				manifest.scripts.dev = manifest.scripts.dev?.replace(workerDev, "$1");
			});
		},
		packages: ["@n8io/baseline-queue"],
		paths: [
			"src/events-open.ts",
			"src/queue-open.ts",
			"src/worker.ts",
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
				? "Remove your Consumers first: they run only in the Worker."
				: undefined,
		srcFiles:
			/(\/api\/[^/]*-schedule(\.test)?\.ts|\/spi\/[^/]*-transaction\.postgres\.test\.ts|-queue\.test\.ts)$/,
	},
	redis: {
		edit: (directory) => {
			for (const env of ["schema", "development", "production", "test"]) {
				textEdit(directory, `.env.${env}`, (text) =>
					text.replace(cacheUrlLines, ""),
				);
			}
		},
		packages: ["redis"],
		paths: ["src/redis.ts", "src/redis.redis.test.ts"],
		refusal: (directory) => {
			const removed = piecesRemovedFind(directory);
			return removed.includes("cache") && removed.includes("live")
				? undefined
				: "Remove the cache and live updates first: both run on Redis.";
		},
	},
	ui: {
		edit: uiEdit,
		packages: [
			"react-router",
			"@react-router/dev",
			"@react-router/node",
			"@tailwindcss/vite",
			"@types/react",
			"@types/react-dom",
			"class-variance-authority",
			"cn",
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
			"src/server-hmr.test.ts",
			"test/integration/csp-nonce.ts",
		],
	},
};

const usage = `usage: pnpm piece-remove <${Object.keys(pieceRemovals).join("|")}>`;

// Why the piece cannot be removed from this Project now, or undefined when it can.
export const pieceRemoveRefusal = (
	directory: string,
	piece: string | undefined,
): string | undefined => {
	const removal = piece === undefined ? undefined : pieceRemovals[piece];
	if (removal === undefined) return usage;
	const status = run("git", ["status", "--porcelain"], { cwd: directory });
	if (status !== "") {
		return "Commit or stash your changes first, so the removal is a commit of its own that git revert can take back.";
	}
	return removal.refusal?.(directory);
};

// Deletes the piece's files and blocks and edits what carries no markers. Leaves packages alone.
export const pieceFilesRemove = (directory: string, piece: string) => {
	const removal = pieceRemovals[piece];
	if (removal === undefined) throw new Error(usage);
	for (const path of removal.paths) {
		rmSync(join(directory, path), { force: true, recursive: true });
	}
	for (const path of trackedFiles(directory)) {
		if (removal.srcFiles?.test(path) && path.startsWith("src/")) {
			rmSync(join(directory, path));
		}
	}
	const start = `piece-start: ${piece}`;
	for (const path of trackedFiles(directory)) {
		if (path.endsWith(".md")) continue;
		textEdit(directory, path, (text) =>
			text.includes(start) ? pieceBlocksRemove(text, piece) : text,
		);
	}
	removal.edit?.(directory);
	const left = trackedFiles(directory).filter(
		(path) =>
			!path.endsWith(".md") &&
			new RegExp(`^[ \\t]*(//|#) ${start}$`, "m").test(
				readFileSync(join(directory, path), "utf8"),
			),
	);
	if (left.length > 0) {
		throw new Error(`${start} has no matching piece-end in ${left.join(", ")}`);
	}
};

export const pieceRemove = (directory: string, piece: string) => {
	pieceFilesRemove(directory, piece);
	const pnpm = (args: string[]) =>
		run("pnpm", args, { cwd: directory, inherit: true });
	const installed = packagesInstalled(directory);
	const packages = pieceRemovals[piece]?.packages.filter((p) =>
		installed.has(p),
	);
	if (packages !== undefined && packages.length > 0) {
		pnpm(["remove", ...packages]);
	}
	if (piece === "ui" && !installed.has("@hono/node-server")) {
		pnpm(["add", "@hono/node-server@^2.1.5"]);
	}
	// Removing an unused import is an unsafe fix in Biome, so it runs on its own.
	pnpm([
		"exec",
		"biome",
		"lint",
		"--write",
		"--unsafe",
		"--only=correctness/noUnusedImports",
		".",
	]);
	pnpm(["exec", "biome", "check", "--write", "."]);
};

const main = () => {
	const directory = process.cwd();
	const piece = process.argv[2];
	const refusal = pieceRemoveRefusal(directory, piece);
	if (refusal !== undefined || piece === undefined) {
		console.error(`piece-remove: ${refusal}`);
		process.exit(1);
	}
	pieceRemove(directory, piece);
	console.log(
		[
			`Removed ${piece}. Next:`,
			"  pnpm check && pnpm test && pnpm build",
			`  git add -A && git commit -m "Remove ${piece}"`,
			"Commit it alone, so git revert can bring the piece back.",
		].join("\n"),
	);
};

if (import.meta.main) main();
