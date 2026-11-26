// Running a Piece removal: pnpm steps, the check, and the undo when it fails.
import { spawnSync } from "node:child_process";
import { pieceFilesRemove } from "./pieces-files.ts";
import {
	dependenciesAllowedPieceRemove,
	packagesInstalled,
} from "./pieces-manifest.ts";
import { type Piece, pieces } from "./pieces-names.ts";
import { gitRun } from "./process-run.ts";

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
