// The Pieces of the stack: each one's identity once, and what removing it does. pnpm piece-remove
// (scripts/piece-remove.ts) is the command; piece-check, template-upgrade, aggregate-create,
// context-create and structure.test.ts import from here. Not a command: importing it runs nothing.
import { spawnSync } from "node:child_process";
import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join, normalize, relative } from "node:path";
import { gitRun } from "./process-run.ts";

// Every Piece of the stack a Project may remove with pnpm piece-remove. A new name here fails
// type-checking until `pieces`, `pieceRemovals` and aggregate-create's piecesTemplate each say what
// the Piece is and does.
export const pieceNames = [
	"analytics",
	"api-reference",
	"cache",
	"error-tracking",
	"live",
	"queue",
	"redis",
	"cli",
	"sdk",
	"ui",
] as const;

export type Piece = (typeof pieceNames)[number];

export const pieceIs = (name: string): name is Piece =>
	(pieceNames as readonly string[]).includes(name);

type PieceIdentity = {
	// Pieces that must go first, when installed.
	after?: Piece[];
	// For a Piece that adds no package to the app: the package folder (its package.json) that tells
	// it is there instead. A folder left with only ignored files, such as node_modules, does not.
	folder?: string;
	// The packages it removes; the first one tells it is there, unless the Piece has a folder.
	packages: string[];
};

export const pieces: Record<Piece, PieceIdentity> = {
	analytics: { packages: ["@n8io/baseline-analytics"] },
	"api-reference": { packages: ["swagger-ui-dist"] },
	cache: { packages: ["@n8io/baseline-cache"] },
	"error-tracking": { packages: ["@n8io/baseline-error-tracking"] },
	live: { packages: ["@n8io/baseline-live"] },
	queue: { packages: ["@n8io/baseline-queue"] },
	redis: { after: ["cache", "live"], packages: ["@n8io/baseline-redis"] },
	cli: { folder: "clients/cli", packages: [] },
	sdk: { after: ["cli"], packages: ["orval"] },
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
	},
};

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
	dependencies?: Record<string, string> | undefined;
	devDependencies?: Record<string, string> | undefined;
	imports?: Record<string, string> | undefined;
	scripts: Partial<Record<string, string>>;
};

// The record without the named keys; a missing record stays missing.
const recordOmit = <Value>(
	record: Record<string, Value> | undefined,
	names: readonly string[],
): Record<string, Value> | undefined =>
	record &&
	Object.fromEntries(
		Object.entries(record).filter(([name]) => !names.includes(name)),
	);

const manifestEdit = (directory: string, edit: (m: Manifest) => Manifest) =>
	textEdit({
		directory,
		path: "package.json",
		edit: (text) => {
			const manifest = JSON.parse(text) as Manifest;
			return `${JSON.stringify(edit(manifest), null, "\t")}\n`;
		},
	});

// dependencies-allowed.json lists the Project's runtime dependencies, so a removed package leaves it too.
const dependenciesAllowedEdit = (
	directory: string,
	edit: (allowed: Record<string, string>) => Record<string, string>,
) =>
	textEdit({
		directory,
		path: "dependencies-allowed.json",
		edit: (text) =>
			`${JSON.stringify(edit(JSON.parse(text) as Record<string, string>), null, "\t")}\n`,
	});

// Drops the Piece's packages; without the UI, Hono serves itself through @hono/node-server.
const dependenciesAllowedPieceRemove = (directory: string, piece: Piece) =>
	dependenciesAllowedEdit(directory, (allowed) => {
		const kept = recordOmit(allowed, pieces[piece].packages) ?? {};
		if (piece !== "ui") return kept;
		return Object.fromEntries(
			Object.entries({
				...kept,
				"@hono/node-server": "serves Hono on Node",
			}).toSorted(([a], [b]) => (a < b ? -1 : 1)),
		);
	});

export const packagesInstalled = (directory: string): Set<string> => {
	const manifest = JSON.parse(
		readFileSync(join(directory, "package.json"), "utf8"),
	) as Manifest;
	return new Set(
		Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }),
	);
};

// What tells a Piece is in a Project: its folder, else its first package.
export const pieceSign = (piece: Piece): string =>
	pieces[piece].folder ?? pieces[piece].packages[0] ?? "";

// The app's packages and the Piece folders the Project holds: every pieceSign it shows.
export const pieceSignsFind = (directory: string): Set<string> =>
	new Set([
		...packagesInstalled(directory),
		...Object.values(pieces).flatMap(({ folder }) =>
			folder !== undefined &&
			existsSync(join(directory, folder, "package.json"))
				? [folder]
				: [],
		),
	]);

const trackedFiles = (directory: string): string[] =>
	gitRun(directory, ["ls-files", "-z"])
		.split("\0")
		.filter((p) => p !== "" && existsSync(join(directory, p)));

// Every Piece whose pieceSign the Project lacks, redis included: the Pieces it removed.
export const piecesRemovedFind = (directory: string): Piece[] => {
	const signs = pieceSignsFind(directory);
	return pieceNames.filter((piece) => !signs.has(pieceSign(piece)));
};

// Drops every block from a `piece-start: <name>` line through its `piece-end: <name>` line.
export const pieceBlocksRemove = (text: string, name: Piece): string =>
	text.replaceAll(
		new RegExp(
			`^[ \\t]*(//|#) piece-start: ${name}\\n[\\s\\S]*?^[ \\t]*(//|#) piece-end: ${name}\\n`,
			"gm",
		),
		"",
	);

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
	manifestEdit(directory, (manifest) => ({
		...manifest,
		imports: recordOmit(manifest.imports, ["#ui/*"]),
		scripts: {
			...manifest.scripts,
			build: "vite build",
			dev: manifest.scripts["dev"]?.replace(
				pieceDevUi,
				"node --watch --import ./src/preload.ts src/server.ts",
			),
		},
	}));
};

// Env files carry no markers: CACHE_URL and the comment lines above it.
const cacheUrlLines = /^(#.*\n)*CACHE_URL=.*\n/m;
// MIXPANEL_TOKEN, its comment and its decorators.
const mixpanelTokenLines = /^(# Mixpanel.*\n)?(# @.*\n)*MIXPANEL_TOKEN=.*\n/m;
// SENTRY_DSN, its comment and its decorators.
const sentryDsnLines = /^(# Sentry.*\n)?(# @.*\n)*SENTRY_DSN=.*\n/m;
// The SCHEDULE_* overrides and the marker aggregate-create adds them at; aggregate-create drops
// them from a new context the same way.
export const pieceScheduleLines =
	/^# schedule overrides.*\n((# @.*\n)?SCHEDULE_.*\n|# wiring: schedules\n)*/m;
// REDIS_HOST_PORT and its decorator.
const redisHostPortLines =
	/^# @type=port @sensitive=false\nREDIS_HOST_PORT=.*\n/m;
// The parts of the `dev` script the ui and queue removals edit (structure.test.ts holds them to it).
export const pieceDevUi =
	"node --import ./src/preload.ts --conditions=development ./node_modules/@react-router/dev/bin.cjs dev";
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
	live: {
		paths: ["src/live-hub-open.ts"],
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
			"test/integration/csp-nonce.ts",
			"test/integration/rollout-build.ts",
			"test/integration/rollout.test.ts",
		],
	},
};

const markerLine = /^[ \t]*(?:\/\/|#) piece-(start|end): ([a-z-]+)$/;

// What is wrong with the Piece markers in a file's text: a start without its end, an end without
// its start, a block of a Piece inside a block of the same Piece, or blocks that cross each other.
// Blocks of different Pieces may nest; they may not interleave.
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

// What `.template.json` says about Pieces: `piecesKept`, the Pieces this Project keeps, and
// `pieceFiles`, the Project's own paths that go with a Piece, such as a test that exercises it.
// They live there, not in pieceRemovals, so scripts/pieces.ts stays the Template's and upgrades never conflict on them.
export type PieceSettings = { files: Record<string, string[]>; kept: string[] };

export const pieceSettingsRead = (directory: string): PieceSettings => {
	const file = join(directory, ".template.json");
	if (!existsSync(file)) return { files: {}, kept: [] };
	let template: { pieceFiles?: unknown; piecesKept?: unknown };
	try {
		template = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(
			`.template.json is not valid JSON: ${(error as Error).message}`,
		);
	}
	if (typeof template !== "object" || template === null) {
		throw new Error(".template.json must hold an object");
	}
	const names = pieceNames.join(", ");
	const kept = template.piecesKept ?? [];
	if (!Array.isArray(kept) || kept.some((p) => typeof p !== "string")) {
		throw new Error(
			`piecesKept in .template.json must be a list of Piece names; Pieces are ${names}`,
		);
	}
	const keptUnknown = kept.filter((p) => !pieceIs(p));
	if (keptUnknown.length > 0) {
		throw new Error(
			`piecesKept in .template.json names ${keptUnknown.join(", ")}, which is no Piece; Pieces are ${names}`,
		);
	}
	const files = template.pieceFiles ?? {};
	if (typeof files !== "object" || files === null || Array.isArray(files)) {
		throw new Error(
			'pieceFiles in .template.json must map a piece to its paths, such as { "ui": ["test/ui"] }',
		);
	}
	for (const [piece, paths] of Object.entries(files)) {
		if (!pieceIs(piece)) {
			throw new Error(
				`pieceFiles in .template.json names ${piece}, which is no Piece; Pieces are ${names}`,
			);
		}
		if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string")) {
			throw new Error(
				`pieceFiles.${piece} in .template.json must be a list of paths`,
			);
		}
		const outside = paths.filter(
			(p) =>
				isAbsolute(p) ||
				[".", ""].includes(normalize(p).replace(/\/$/, "")) ||
				normalize(p).split("/")[0] === "..",
		);
		if (outside.length > 0) {
			throw new Error(
				`pieceFiles.${piece} in .template.json names ${outside.join(", ")}, which is not a path inside the Project; give paths from the Project root, such as test/ui`,
			);
		}
	}
	return { files: files as Record<string, string[]>, kept };
};

export const pieceUsage = `Usage: pnpm piece-remove <${pieceNames.join("|")}>

  -h, --help  this help`;

// Why the Piece cannot be removed from this Project now, or undefined when it can.
export const pieceRemoveRefusal = (
	directory: string,
	piece: Piece,
): string | undefined => {
	const status = gitRun(directory, ["status", "--porcelain"]);
	try {
		pieceSettingsRead(directory);
	} catch (error) {
		return (error as Error).message;
	}
	if (status !== "") {
		return "Commit or stash your changes first, so the removal is a commit of its own that git revert can take back.";
	}
	return pieceRemovals[piece].refusal?.(directory);
};

// A test file that lost every test with its blocks has nothing left to run.
const testCall = /(?<![.\w])(?:it|test)(?:\.\w+)*[(`]/;
const testsLeft = (text: string) =>
	testCall.test(text.replace(/^\s*\/\/.*$/gm, ""));

// Every file under a directory that is not a git checkout, as paths from it.
export const filesWalk = (directory: string): string[] =>
	readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((e) => e.isFile() && !e.parentPath.includes("node_modules"))
		.map((e) => relative(directory, join(e.parentPath, e.name)));

// Deletes the Piece's files and blocks and edits what carries no markers. Leaves packages alone.
// `filesList` says which files exist.
const filesRemove = ({
	directory,
	filesList,
	piece,
}: {
	directory: string;
	filesList: (directory: string) => string[];
	piece: Piece;
}) => {
	const removal = pieceRemovals[piece];
	for (const path of filesList(directory)) {
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
	for (const path of [
		...removal.paths,
		...(pieceSettingsRead(directory).files[piece] ?? []),
	]) {
		rmSync(join(directory, path), { force: true, recursive: true });
	}
	for (const path of filesList(directory)) {
		if (removal.srcFiles?.test(path) && path.startsWith("src/")) {
			rmSync(join(directory, path));
		}
	}
	const start = `piece-start: ${piece}`;
	for (const path of filesList(directory)) {
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
	const left = filesList(directory).filter(
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

export const pieceFilesRemove = (directory: string, piece: Piece) =>
	filesRemove({ directory, filesList: trackedFiles, piece });

// A freshly rendered tree as a Project that removed those Pieces would have it: the Pieces' files,
// blocks, env lines and packages, by the same file, block, env and package steps as `pnpm piece-remove`. template-upgrade
// renders both releases this way, so a removed Piece never comes back.
export const piecesRemoveFromTree = (directory: string, removed: Piece[]) => {
	for (const piece of removed) {
		filesRemove({ directory, filesList: filesWalk, piece });
		const { packages } = pieces[piece];
		manifestEdit(directory, (manifest) => ({
			...manifest,
			dependencies: recordOmit(manifest.dependencies, packages),
			devDependencies: recordOmit(manifest.devDependencies, packages),
		}));
		dependenciesAllowedPieceRemove(directory, piece);
	}
};

// What a failed removal tells the person.
export type PieceRemoveFailure = {
	// Files the failing check names: the code that uses the Piece outside its markers.
	files: string[];
	output: string;
	// Set when the package manager failed (registry, network, store), not the Project's code:
	// the command that failed, such as `pnpm remove`. The Piece is not to blame.
	packageManager?: string;
	// False when the undo's own `pnpm install` failed too, so the tree needs one.
	restored?: boolean;
};

class PackageManagerError extends Error {
	readonly command: string;
	constructor({ command, output }: { command: string; output: string }) {
		super(output);
		this.command = command;
	}
}

const filePath =
	/(?:^|[\s'"(])(?:\.\/)?((?:src|test|scripts)\/[\w./@$-]+?\.tsx?)(?![\w]|\.\w)/gm;

export const filesNamedIn = (output: string): string[] => [
	...new Set([...output.matchAll(filePath)].map((m) => m[1] ?? "")),
];

// Unlike processRun it never throws and never shows output: it returns whether pnpm succeeded and
// what it printed (colour off), so a failed removal can be read, undone and reported.
export const pnpmRun = (directory: string, args: string[]) => {
	const result = spawnSync("pnpm", args, {
		cwd: directory,
		encoding: "utf8",
		env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
		maxBuffer: 64 * 1024 * 1024,
	});
	return {
		ok: result.status === 0,
		output: [
			result.stdout,
			result.stderr,
			result.error?.message,
			result.signal === null ? undefined : `(ended with ${result.signal})`,
		]
			.filter((part) => part !== undefined && part !== null)
			.join("")
			.trim(),
	};
};

// Puts the tree back as `git status` found it clean: the removal is all or nothing.
const removalUndo = (directory: string): boolean => {
	// :/ is the whole repository: pnpm remove can rewrite a lockfile above the app.
	for (const args of [
		["restore", "--staged", "--worktree", ":/"],
		["clean", "-fd", ":/"],
	]) {
		gitRun(directory, args);
	}
	return pnpmRun(directory, ["install"]).ok;
};

// Removes the Piece, then requires `pnpm check` to pass. On a failure it undoes the removal and
// returns what failed; on success it leaves the removal in the tree, uncommitted.
export const pieceRemove = (
	directory: string,
	piece: Piece,
): PieceRemoveFailure | undefined => {
	const failure = (
		output: string,
		packageManager?: string,
	): PieceRemoveFailure => {
		const restored = removalUndo(directory);
		return {
			files: packageManager === undefined ? filesNamedIn(output) : [],
			restored,
			...(packageManager === undefined ? {} : { packageManager }),
			output: restored
				? output
				: `${output}\n\npnpm install failed after the undo: run it again.`,
		};
	};
	try {
		pieceFilesRemove(directory, piece);
		const pnpm = (args: string[]) => {
			const ran = pnpmRun(directory, args);
			if (!ran.ok) {
				throw new PackageManagerError({
					command: `pnpm ${args[0]}`,
					output: ran.output,
				});
			}
		};
		const installed = packagesInstalled(directory);
		const packages = pieces[piece].packages.filter((p) => installed.has(p));
		if (packages.length > 0) {
			pnpm(["remove", ...packages]);
		} else if (pieces[piece].folder !== undefined) {
			// The folder was a workspace package: the lockfile drops its importer. Under CI pnpm
			// installs frozen by default and would keep it.
			pnpm(["install", "--no-frozen-lockfile"]);
		}
		if (piece === "ui" && !installed.has("@hono/node-server")) {
			pnpm(["add", "@hono/node-server@^2.1.6"]);
		}
		dependenciesAllowedPieceRemove(directory, piece);
		// Removing an unused import is an unsafe fix in Biome, so it runs on its own.
		pnpmRun(directory, [
			"exec",
			"biome",
			"lint",
			"--write",
			"--unsafe",
			"--only=correctness/noUnusedImports",
			".",
		]);
		pnpmRun(directory, ["exec", "biome", "check", "--write", "."]);
	} catch (error) {
		if (error instanceof PackageManagerError) {
			return failure(error.message, error.command);
		}
		return failure((error as Error).message);
	}
	const checked = pnpmRun(directory, ["check"]);
	return checked.ok ? undefined : failure(checked.output);
};
