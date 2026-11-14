// pnpm piece-check [piece...]: proves that every installed piece can still be removed. Each runs
// `pnpm piece-remove`, `pnpm check` and `pnpm test` on a throwaway git worktree of HEAD, so your
// tree is left alone and uncommitted changes are not checked. A piece listed in `.template.json`
// as `piecesKept` is skipped: the Project keeps it and its new code needs no markers. The
// `pieces` job in app-ci.yml runs it. docs/agents/pieces.md says what to do when it fails.
import {
	existsSync,
	mkdtempDisposableSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	filesNamedIn,
	packagesInstalled,
	pieceRemovals,
	pieceRemove,
	toolRun,
} from "./piece-remove.ts";
import { run } from "./template-render.ts";

export type PieceCheckPlan = {
	// Each piece to check, with the pieces to remove before it in the same worktree.
	checks: { first: string[]; piece: string }[];
	// Why a piece is not checked.
	notes: string[];
};

// Which pieces to check: those installed, not kept, and not blocked by a Consumer.
export const pieceCheckPlan = ({
	installed,
	kept,
	refusal,
	requested,
}: {
	installed: Set<string>;
	kept: string[];
	// Why a piece cannot be removed at all, as piece-remove would say.
	refusal: (piece: string) => string | undefined;
	requested: string[];
}): PieceCheckPlan => {
	const plan: PieceCheckPlan = { checks: [], notes: [] };
	const present = (piece: string) =>
		installed.has(pieceRemovals[piece]?.packages[0] ?? "");
	for (const piece of Object.keys(pieceRemovals)) {
		if (requested.length > 0 && !requested.includes(piece)) continue;
		if (!present(piece)) {
			plan.notes.push(`${piece}: not installed`);
			continue;
		}
		if (kept.includes(piece)) {
			plan.notes.push(`${piece}: kept (piecesKept in .template.json)`);
			continue;
		}
		const first = (pieceRemovals[piece]?.after ?? []).filter(present);
		const keptFirst = first.find((p) => kept.includes(p));
		if (keptFirst !== undefined) {
			plan.notes.push(`${piece}: skipped, ${keptFirst} is kept and runs on it`);
			continue;
		}
		// A piece that goes after others is refused only until they go, which the check does itself.
		const why = first.length === 0 ? refusal(piece) : undefined;
		if (why !== undefined) {
			plan.notes.push(`${piece}: skipped, ${why}`);
			continue;
		}
		plan.checks.push({ first, piece });
	}
	return plan;
};

const piecesKeptRead = (directory: string): string[] => {
	const file = join(directory, ".template.json");
	if (!existsSync(file)) return [];
	const template = JSON.parse(readFileSync(file, "utf8")) as {
		piecesKept?: string[];
	};
	const kept = template.piecesKept ?? [];
	const unknown = kept.filter((p) => pieceRemovals[p] === undefined);
	if (unknown.length > 0) {
		throw new Error(
			`piecesKept in .template.json names ${unknown.join(", ")}, which is no piece; pieces are ${Object.keys(pieceRemovals).join(", ")}`,
		);
	}
	return kept;
};

const git = (directory: string, args: string[]) =>
	run({ command: "git", args, options: { cwd: directory } });

// A checkout of HEAD that goes away with the scope; `path` is the app inside it.
const worktreeCreate = (directory: string) => {
	const folder = mkdtempDisposableSync(join(tmpdir(), "piece-check-"));
	const root = join(folder.path, "tree");
	try {
		git(directory, ["worktree", "add", "--detach", "--quiet", root, "HEAD"]);
	} catch (error) {
		rmSync(folder.path, { force: true, recursive: true });
		throw error;
	}
	return {
		path: join(root, git(directory, ["rev-parse", "--show-prefix"]).trim()),
		[Symbol.dispose]() {
			try {
				git(directory, ["worktree", "remove", "--force", root]);
			} finally {
				rmSync(folder.path, { force: true, recursive: true });
				git(directory, ["worktree", "prune"]);
			}
		},
	};
};

type PieceCheckFailure = { files: string[]; output: string; step: string };

const pieceCheck = (
	directory: string,
	{ first, piece }: { first: string[]; piece: string },
): PieceCheckFailure | undefined => {
	using worktree = worktreeCreate(directory);
	const tree = worktree.path;
	const installed = toolRun(tree, ["install", "--frozen-lockfile"]);
	if (!installed.ok) {
		return { files: [], output: installed.output, step: "pnpm install" };
	}
	for (const name of [...first, piece]) {
		const failed = pieceRemove(tree, name);
		if (failed !== undefined) {
			return { ...failed, step: `pnpm piece-remove ${name}` };
		}
	}
	const tested = toolRun(tree, ["test"]);
	return tested.ok
		? undefined
		: {
				files: filesNamedIn(tested.output),
				output: tested.output,
				step: "pnpm test",
			};
};

const main = () => {
	const directory = process.cwd();
	const requested = process.argv.slice(2);
	const unknown = requested.filter((p) => pieceRemovals[p] === undefined);
	if (unknown.length > 0) {
		console.error(
			`piece-check: unknown piece ${unknown.join(", ")}; pieces are ${Object.keys(pieceRemovals).join(", ")}`,
		);
		process.exit(1);
	}
	const plan = pieceCheckPlan({
		installed: packagesInstalled(directory),
		kept: piecesKeptRead(directory),
		refusal: (piece) => pieceRemovals[piece]?.refusal?.(directory),
		requested,
	});
	for (const note of plan.notes) console.log(`piece-check: ${note}`);
	const failures: string[] = [];
	for (const check of plan.checks) {
		const started = Date.now();
		const failed = pieceCheck(directory, check);
		if (failed === undefined) {
			console.log(
				`piece-check: ${check.piece} passes check and test without it (${Math.round((Date.now() - started) / 1000)} s)`,
			);
			continue;
		}
		failures.push(check.piece);
		console.error(
			[
				`piece-check: ${check.piece} fails at ${failed.step}.`,
				failed.files.length > 0
					? `Code that uses ${check.piece} outside its piece markers, or fails without it:\n${failed.files.map((f) => `  ${f}`).join("\n")}`
					: "",
				failed.output.split("\n").slice(-40).join("\n"),
			]
				.filter((part) => part !== "")
				.join("\n"),
		);
	}
	if (failures.length > 0) {
		console.error(
			`piece-check: ${failures.join(", ")} can no longer be removed. Wrap the code that uses it in piece markers (docs/agents/pieces.md), or list the piece in piecesKept in .template.json if this Project keeps it.`,
		);
		process.exit(1);
	}
};

if (import.meta.main) main();
