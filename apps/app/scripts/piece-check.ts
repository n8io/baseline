// pnpm piece-check [piece...]: proves that every installed piece can still be removed. Each runs
// `pnpm piece-remove`, `pnpm check` and `pnpm test` on its own throwaway git worktree of HEAD, so
// your tree is left alone and uncommitted changes are not checked. The pieces and the check of
// the unmodified tree run at the same time, one per CPU, each in a child process whose output is
// printed whole only when it fails. A piece listed in `.template.json` as `piecesKept` is
// skipped: the Project keeps it and its new code needs no markers. The `pieces` job in
// app-ci.yml runs it. docs/agents/pieces.md says what to do when it fails.
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdtempDisposableSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, join } from "node:path";
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

// A checkout of HEAD that goes away with the scope; `path` is the app inside it. The folder's
// unique name is also the worktree's name in git, so checks running at once never share one.
const worktreeCreate = (directory: string) => {
	const folder = mkdtempDisposableSync(join(tmpdir(), "piece-check-"));
	const root = join(folder.path, basename(folder.path));
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

// `pnpm check` and `pnpm test` on HEAD with nothing removed. A tree that fails them fails every
// piece's check for the same reason, so no piece is to blame until this passes.
const treeCheck = (directory: string): PieceCheckFailure | undefined => {
	using worktree = worktreeCreate(directory);
	const tree = worktree.path;
	const installed = toolRun(tree, ["install", "--frozen-lockfile"]);
	if (!installed.ok) {
		return { files: [], output: installed.output, step: "pnpm install" };
	}
	for (const step of ["check", "test"]) {
		const ran = toolRun(tree, [step]);
		if (!ran.ok) return { files: [], output: ran.output, step: `pnpm ${step}` };
	}
	return undefined;
};

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

// One unit of work for a child process: the unmodified tree, or a piece.
type PieceCheckJob = { tree: true } | { first: string[]; piece: string };

// A child exits with this code when its check fails. Any other ending (a throw, a kill, no
// memory) says nothing about a piece, so it blames none.
const checkFailedCode = 3;

// Runs one job in this process and returns why it fails, if it does.
const jobRun = (directory: string, job: PieceCheckJob): string | undefined => {
	if ("tree" in job) {
		const broken = treeCheck(directory);
		return broken === undefined
			? undefined
			: [
					`piece-check: fix the tree first: ${broken.step} fails on HEAD before any piece is removed, so no piece is to blame.`,
					broken.output.split("\n").slice(-40).join("\n"),
				].join("\n");
	}
	const { piece } = job;
	const failed = pieceCheck(directory, job);
	if (failed === undefined) return undefined;
	return [
		`piece-check: ${piece} fails at ${failed.step}.`,
		failed.files.length > 0
			? `Code that uses ${piece} outside its piece markers, or fails without it:\n${failed.files.map((f) => `  ${f}`).join("\n")}`
			: "",
		failed.output.split("\n").slice(-40).join("\n"),
	]
		.filter((part) => part !== "")
		.join("\n");
};

type JobEnd = { outcome: "crashed" | "failed" | "passed"; output: string };

// Runs one job in a child process of this script, keeping its output until it ends.
const jobSpawn = (directory: string, job: PieceCheckJob) =>
	new Promise<JobEnd>((done) => {
		const child = spawn(
			process.execPath,
			[...process.execArgv, import.meta.filename, "--job", JSON.stringify(job)],
			{
				cwd: directory,
				env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let output = "";
		for (const stream of [child.stdout, child.stderr]) {
			stream.setEncoding("utf8");
			stream.on("data", (chunk: string) => {
				output += chunk;
			});
		}
		child.on("error", (error) =>
			done({ outcome: "crashed", output: String(error) }),
		);
		child.on("close", (code, signal) => {
			const text = output.trim();
			if (code === 0) done({ outcome: "passed", output: text });
			else if (code === checkFailedCode)
				done({ outcome: "failed", output: text });
			else {
				done({
					outcome: "crashed",
					output:
						`${text}\n(the check ended with ${signal ?? `exit code ${code}`})`.trim(),
				});
			}
		});
	});

// Calls `each` on every item, at most `limit` at once, starting them in the order given.
export const eachConcurrently = async <T>({
	each,
	items,
	limit,
}: {
	each: (item: T) => Promise<void>;
	items: T[];
	limit: number;
}) => {
	const waiting = [...items];
	const lane = async () => {
		while (waiting.length > 0) await each(waiting.shift() as T);
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, lane),
	);
};

const main = async () => {
	const directory = process.cwd();
	if (process.argv[2] === "--job") {
		const failed = jobRun(
			directory,
			JSON.parse(process.argv[3] ?? "") as PieceCheckJob,
		);
		if (failed !== undefined) {
			console.error(failed);
			process.exitCode = checkFailedCode;
		}
		return;
	}
	const requested = process.argv.slice(2);
	const unknown = requested.filter((p) => pieceRemovals[p] === undefined);
	if (unknown.length > 0) {
		console.error(
			`piece-check: unknown piece ${unknown.join(", ")}; pieces are ${Object.keys(pieceRemovals).join(", ")}`,
		);
		process.exitCode = 1;
		return;
	}
	const plan = pieceCheckPlan({
		installed: packagesInstalled(directory),
		kept: piecesKeptRead(directory),
		refusal: (piece) => pieceRemovals[piece]?.refusal?.(directory),
		requested,
	});
	for (const note of plan.notes) console.log(`piece-check: ${note}`);
	if (plan.checks.length === 0) return;
	// The unmodified tree starts first and runs alongside the pieces. A piece's result is
	// reported only once the tree has passed: when the tree fails, no piece is to blame.
	let tree: JobEnd | undefined;
	const { promise: treeChecked, resolve: treeCheckEnd } =
		Promise.withResolvers<void>();
	// Output of each piece that fails or could not be checked, printed whole at the end.
	const failures = new Map<string, string>();
	const crashes = new Map<string, string>();
	await eachConcurrently({
		each: async (job: PieceCheckJob) => {
			if (tree !== undefined && tree.outcome !== "passed") return;
			const started = Date.now();
			const end = await jobSpawn(directory, job).catch(
				(error): JobEnd => ({ outcome: "crashed", output: String(error) }),
			);
			const seconds = Math.round((Date.now() - started) / 1000);
			if ("tree" in job) {
				tree = end;
				treeCheckEnd();
				return;
			}
			await treeChecked;
			if (tree?.outcome !== "passed") return;
			if (end.outcome === "passed") {
				console.log(
					`piece-check: ${job.piece} passes check and test without it (${seconds} s)`,
				);
				return;
			}
			(end.outcome === "failed" ? failures : crashes).set(
				job.piece,
				end.output,
			);
			console.log(
				end.outcome === "failed"
					? `piece-check: ${job.piece} fails (${seconds} s)`
					: `piece-check: ${job.piece} could not be checked (${seconds} s)`,
			);
		},
		items: [{ tree: true }, ...plan.checks],
		limit: 2,
	});
	if (tree?.outcome === "failed") {
		console.error(tree.output);
		process.exitCode = 1;
		return;
	}
	if (tree?.outcome === "crashed") {
		console.error(
			`piece-check: the check of the unmodified tree stopped before it ended, so no piece is to blame. Run it again.\n${tree.output}`,
		);
		process.exitCode = 1;
		return;
	}
	const inOrder = (ended: Map<string, string>) =>
		plan.checks.map((c) => c.piece).filter((piece) => ended.has(piece));
	for (const piece of [...inOrder(failures), ...inOrder(crashes)]) {
		console.error(failures.get(piece) ?? crashes.get(piece));
	}
	if (failures.size > 0) {
		console.error(
			`piece-check: ${inOrder(failures).join(", ")} can no longer be removed. Wrap the code that uses it in piece markers (docs/agents/pieces.md), or list the piece in piecesKept in .template.json if this Project keeps it.`,
		);
	}
	if (crashes.size > 0) {
		console.error(
			`piece-check: the check of ${inOrder(crashes).join(", ")} stopped before it ended (a crash or a kill, often out of memory), which blames no piece. Run it again.`,
		);
	}
	if (failures.size > 0 || crashes.size > 0) process.exitCode = 1;
};

if (import.meta.main) await main();
