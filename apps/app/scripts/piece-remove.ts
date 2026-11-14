// pnpm piece-remove <piece>: removes a piece of the stack from this Project (ui, live, cache,
// redis, queue, analytics or error-tracking). It deletes the piece's files and its `piece-start:` to `piece-end:`
// blocks, removes its packages and the imports nothing uses any more, runs `pnpm check`, and never
// commits. When the check fails it undoes the removal and lists the files that use the piece outside
// its markers. docs/agents/pieces.md says what each piece is and how to take one back. Running it
// again after a template-upgrade takes out the lines the upgrade brought back.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pieceBlocksRemove, piecesRemovedFind } from "./domain-create.ts";
import { run } from "./template-render.ts";

type PieceRemoval = {
	// Pieces that must go first, when installed.
	after?: string[];
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

const textEdit = ({
	directory,
	edit,
	path,
}: {
	directory: string;
	edit: (text: string) => string;
	path: string;
}) => {
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
	textEdit({
		directory,
		path: "package.json",
		edit: (text) => {
			const manifest = JSON.parse(text) as Manifest;
			edit(manifest);
			return `${JSON.stringify(manifest, null, "\t")}\n`;
		},
	});

export const packagesInstalled = (directory: string): Set<string> => {
	const manifest = JSON.parse(
		readFileSync(join(directory, "package.json"), "utf8"),
	) as Manifest;
	return new Set(
		Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }),
	);
};

const trackedFiles = (directory: string): string[] =>
	run({ command: "git", args: ["ls-files", "-z"], options: { cwd: directory } })
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
	textEdit({
		directory,
		path: "biome.json",
		edit: (text) => {
			const biome = JSON.parse(text) as {
				css?: unknown;
				files: { includes: string[] };
			};
			delete biome.css;
			biome.files.includes = biome.files.includes.filter(
				(p) => p !== "!.react-router",
			);
			return `${JSON.stringify(biome, null, "\t")}\n`;
		},
	});
	writeFileSync(join(directory, "vite.config.ts"), apiViteConfig);
	textEdit({
		directory,
		path: "src/server.ts",
		edit: (text) =>
			text.includes("serverServe(serve(")
				? text
				: `${text.replace(/^import /m, `${nodeServerImport}import `)}${apiServeLines}`,
	});
	manifestEdit(directory, (manifest) => {
		manifest.scripts.build = "vite build";
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
// REDIS_HOST_PORT, its decorator, and the unit tests' CACHE_URL.
const redisHostPortLines =
	/^# @type=port @sensitive=false\nREDIS_HOST_PORT=.*\n/m;
const workerDev =
	/\(HEALTH_PORT=9001 node --watch --import \.\/src\/preload\.ts src\/worker\.ts & ([^)]*)\)/;

export const pieceRemovals: Record<string, PieceRemoval> = {
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
				textEdit({
					directory,
					path: `.env.${env}`,
					edit: (text) => text.replace(sentryDsnLines, ""),
				});
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
			textEdit({
				directory,
				path: ".env.schema",
				edit: (text) => text.replace(scheduleLines, ""),
			});
			manifestEdit(directory, (manifest) => {
				manifest.scripts.dev = manifest.scripts.dev?.replace(workerDev, "$1");
			});
		},
		packages: ["@n8io/baseline-queue"],
		paths: [
			"src/events-open.ts",
			"src/queue-open.ts",
			"src/worker.ts",
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
				? "Remove your Consumers first: they run only in the Worker."
				: undefined,
		srcFiles:
			/(\/api\/[^/]*-schedule(\.test)?\.ts|\/spi\/[^/]*-transaction\.postgres\.test\.ts|-queue\.test\.ts)$/,
	},
	redis: {
		after: ["cache", "live"],
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
		packages: ["@n8io/baseline-redis"],
		paths: ["src/redis-open.ts"],
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
			"src/server-hmr.test.ts",
			"test/integration/csp-nonce.ts",
			"test/integration/rollout-build.ts",
			"test/integration/rollout.test.ts",
		],
	},
};

const markerLine = /^[ \t]*(?:\/\/|#) piece-(start|end): ([a-z-]+)$/;

// What is wrong with the piece markers in a file's text: a start without its end, an end without
// its start, a block of a piece inside a block of the same piece, or blocks that cross each other.
// Blocks of different pieces may nest; they may not interleave.
export const pieceMarkersProblems = (text: string): string[] => {
	const problems: string[] = [];
	const open: { line: number; piece: string }[] = [];
	for (const [index, content] of text.split("\n").entries()) {
		const found = markerLine.exec(content);
		const edge = found?.[1];
		const piece = found?.[2];
		if (edge === undefined || piece === undefined) continue;
		const line = index + 1;
		if (edge === "start") {
			if (open.some((o) => o.piece === piece)) {
				problems.push(
					`line ${line}: piece-start: ${piece} inside another ${piece} block`,
				);
			}
			open.push({ line, piece });
			continue;
		}
		const at = open.findLastIndex((o) => o.piece === piece);
		if (at === -1) {
			problems.push(`line ${line}: piece-end: ${piece} has no piece-start`);
		} else if (at !== open.length - 1) {
			const inner = open[open.length - 1]?.piece;
			problems.push(
				`line ${line}: piece-end: ${piece} closes it while ${inner} is still open (blocks cross)`,
			);
			open.splice(at, 1);
		} else {
			open.pop();
		}
	}
	for (const o of open) {
		problems.push(`line ${o.line}: piece-start: ${o.piece} has no piece-end`);
	}
	return problems;
};

const usage = `usage: pnpm piece-remove <${Object.keys(pieceRemovals).join("|")}>`;

// Why the piece cannot be removed from this Project now, or undefined when it can.
export const pieceRemoveRefusal = (
	directory: string,
	piece: string | undefined,
): string | undefined => {
	const removal = piece === undefined ? undefined : pieceRemovals[piece];
	if (removal === undefined) return usage;
	const status = run({
		command: "git",
		args: ["status", "--porcelain"],
		options: { cwd: directory },
	});
	if (status !== "") {
		return "Commit or stash your changes first, so the removal is a commit of its own that git revert can take back.";
	}
	return removal.refusal?.(directory);
};

// A test file that lost every test with its blocks has nothing left to run.
const testCall = /(?<![.\w])(?:it|test)(?:\.\w+)*[(`]/;
const testsLeft = (text: string) =>
	testCall.test(text.replace(/^\s*\/\/.*$/gm, ""));

// Deletes the piece's files and blocks and edits what carries no markers. Leaves packages alone.
export const pieceFilesRemove = (directory: string, piece: string) => {
	const removal = pieceRemovals[piece];
	if (removal === undefined) throw new Error(usage);
	for (const path of trackedFiles(directory)) {
		if (path.endsWith(".md")) continue;
		const problems = pieceMarkersProblems(
			readFileSync(join(directory, path), "utf8"),
		);
		if (problems.length > 0) {
			throw new Error(
				`piece markers in ${path} do not balance: ${problems.join("; ")}`,
			);
		}
	}
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
		const file = join(directory, path);
		const text = readFileSync(file, "utf8");
		if (!text.includes(start)) continue;
		const edited = pieceBlocksRemove(text, piece);
		if (/\.test\.tsx?$/.test(path) && !testsLeft(edited)) {
			rmSync(file);
		} else if (edited !== text) {
			writeFileSync(file, edited);
		}
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

// What a failed removal tells the person.
export type PieceRemoveFailure = {
	// Files the failing check names: the code that uses the piece outside its markers.
	files: string[];
	output: string;
};

const filePath =
	/(?:^|[\s'"(])(?:\.\/)?((?:src|test|scripts)\/[\w./@$-]+?\.tsx?)(?![\w]|\.\w)/gm;

export const filesNamedIn = (output: string): string[] => [
	...new Set([...output.matchAll(filePath)].map((m) => m[1] ?? "")),
];

export const toolRun = (directory: string, args: string[]) => {
	const result = spawnSync("pnpm", args, {
		cwd: directory,
		encoding: "utf8",
		env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
		maxBuffer: 64 * 1024 * 1024,
	});
	return {
		ok: result.status === 0,
		output: `${result.stdout}${result.stderr}`.trim(),
	};
};

// Puts the tree back as `git status` found it clean: the removal is all or nothing.
const removalUndo = (directory: string): boolean => {
	// :/ is the whole repository: pnpm remove can rewrite a lockfile above the app.
	for (const args of [
		["restore", "--staged", "--worktree", ":/"],
		["clean", "-fd", ":/"],
	]) {
		run({ command: "git", args, options: { cwd: directory } });
	}
	return toolRun(directory, ["install"]).ok;
};

// Removes the piece, then requires `pnpm check` to pass. On a failure it undoes the removal and
// returns what failed; on success it leaves the removal in the tree, uncommitted.
export const pieceRemove = (
	directory: string,
	piece: string,
): PieceRemoveFailure | undefined => {
	const failure = (output: string): PieceRemoveFailure => {
		const restored = removalUndo(directory);
		return {
			files: filesNamedIn(output),
			output: restored
				? output
				: `${output}\n\npnpm install failed after the undo: run it again.`,
		};
	};
	try {
		pieceFilesRemove(directory, piece);
		const pnpm = (args: string[]) =>
			run({
				command: "pnpm",
				args,
				options: { cwd: directory, inherit: true },
			});
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
		toolRun(directory, [
			"exec",
			"biome",
			"lint",
			"--write",
			"--unsafe",
			"--only=correctness/noUnusedImports",
			".",
		]);
		toolRun(directory, ["exec", "biome", "check", "--write", "."]);
	} catch (error) {
		return failure((error as Error).message);
	}
	const checked = toolRun(directory, ["check"]);
	return checked.ok ? undefined : failure(checked.output);
};

const main = () => {
	const directory = process.cwd();
	const piece = process.argv[2];
	const refusal = pieceRemoveRefusal(directory, piece);
	if (refusal !== undefined || piece === undefined) {
		console.error(`piece-remove: ${refusal}`);
		process.exit(1);
	}
	const failed = pieceRemove(directory, piece);
	if (failed !== undefined) {
		const lines = [
			`piece-remove: removing ${piece} failed, so the removal is undone and the tree is as you left it.`,
		];
		if (failed.files.length > 0) {
			lines.push(
				`These files use ${piece} outside its piece markers, or fail for another reason:`,
				...failed.files.map((f) => `  ${f}`),
				`Wrap the code that uses ${piece} in \`// piece-start: ${piece}\` and \`// piece-end: ${piece}\` lines (docs/agents/pieces.md), then run pnpm piece-remove ${piece} again.`,
			);
		}
		lines.push("", ...failed.output.split("\n").slice(-40));
		console.error(lines.join("\n"));
		process.exit(1);
	}
	console.log(
		[
			`Removed ${piece}; pnpm check passes. Next:`,
			"  pnpm test && pnpm build",
			`  git add -A && git commit -m "Remove ${piece}"`,
			"Commit it alone, so git revert can bring the piece back.",
		].join("\n"),
	);
};

if (import.meta.main) main();
