// One check in a throwaway git worktree of HEAD: the unmodified tree, or a piece removed from it.
import { mkdtempDisposableSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { filesNamedIn, type Piece, pieceRemove, pnpmRun } from "./pieces.ts";
import { gitRun } from "./process-run.ts";

// A checkout of HEAD that goes away with the scope; `path` is the app inside it. The folder's
// unique name is also the worktree's name in git, so checks running at once never share one.
const worktreeCreate = (directory: string) => {
	const folder = mkdtempDisposableSync(join(tmpdir(), "piece-check-"));
	const root = join(folder.path, basename(folder.path));
	try {
		gitRun(directory, ["worktree", "add", "--detach", "--quiet", root, "HEAD"]);
	} catch (error) {
		rmSync(folder.path, { force: true, recursive: true });
		throw error;
	}
	return {
		path: join(root, gitRun(directory, ["rev-parse", "--show-prefix"]).trim()),
		[Symbol.dispose]() {
			try {
				gitRun(directory, ["worktree", "remove", "--force", root]);
			} finally {
				rmSync(folder.path, { force: true, recursive: true });
				gitRun(directory, ["worktree", "prune"]);
			}
		},
	};
};

// `unchecked` marks a failure that says nothing about the tree or the piece: the install of
// dependencies failed (registry error, store race, network), so no check ran.
export type PieceCheckFailure = {
	files: string[];
	output: string;
	step: string;
	unchecked?: boolean;
};

export const pieceCheckFailureInstall = (
	output: string,
): PieceCheckFailure => ({
	files: [],
	output,
	step: "pnpm install",
	unchecked: true,
});

// `pnpm check` and `pnpm test` on HEAD with nothing removed. A tree that fails them fails every
// piece's check for the same reason, so no piece is to blame until this passes.
export const treeCheck = (directory: string): PieceCheckFailure | undefined => {
	using worktree = worktreeCreate(directory);
	const tree = worktree.path;
	const installed = pnpmRun(tree, ["install", "--frozen-lockfile"]);
	if (!installed.ok) {
		return pieceCheckFailureInstall(installed.output);
	}
	for (const step of ["check", "test"]) {
		const ran = pnpmRun(tree, [step]);
		if (!ran.ok) return { files: [], output: ran.output, step: `pnpm ${step}` };
	}
	return undefined;
};

// The tools a piece's check runs in its worktree; a test replaces them.
type PieceCheckTools = {
	pieceRemove: typeof pieceRemove;
	pnpmRun: typeof pnpmRun;
};

// Installs, removes the pieces and tests in a worktree at `tree`. Only a failure after a
// successful install blames the piece.
export const pieceCheckRun = ({
	first,
	piece,
	tools,
	tree,
}: {
	first: Piece[];
	piece: Piece;
	tools: PieceCheckTools;
	tree: string;
}): PieceCheckFailure | undefined => {
	const installed = tools.pnpmRun(tree, ["install", "--frozen-lockfile"]);
	if (!installed.ok) return pieceCheckFailureInstall(installed.output);
	for (const name of [...first, piece]) {
		const failed = tools.pieceRemove(tree, name);
		if (failed !== undefined) {
			return {
				...failed,
				step: `pnpm piece-remove ${name}`,
				...(failed.packageManager === undefined
					? {}
					: { step: failed.packageManager, unchecked: true }),
			};
		}
	}
	const tested = tools.pnpmRun(tree, ["test"]);
	return tested.ok
		? undefined
		: {
				files: filesNamedIn(tested.output),
				output: tested.output,
				step: "pnpm test",
			};
};

export const pieceCheck = (
	directory: string,
	{ first, piece }: { first: Piece[]; piece: Piece },
): PieceCheckFailure | undefined => {
	using worktree = worktreeCreate(directory);
	return pieceCheckRun({
		first,
		piece,
		tools: { pieceRemove, pnpmRun },
		tree: worktree.path,
	});
};
