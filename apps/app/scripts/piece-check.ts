// pnpm piece-check [piece...]: proves that every installed piece can still be removed. Each runs
// `pnpm piece-remove`, `pnpm check` and `pnpm test` on its own throwaway git worktree of HEAD, so
// your tree is left alone and uncommitted changes are not checked. The unmodified tree is checked
// first, then the pieces two at a time, each in a child process whose output is printed whole
// only when it fails. `--skip-tree` leaves out the unmodified tree's check, for CI jobs that run one
// piece each next to the `check` and `unit` jobs. A piece listed in `.template.json` as `piecesKept` is
// skipped: the Project keeps it and its new code needs no markers. The `pieces` job in
// app-ci.yml runs it. docs/agents/pieces.md says what to do when it fails.
import { availableParallelism } from "node:os";
import { argsParse } from "./args.ts";
import {
	eachConcurrently,
	type JobEnd,
	jobRun,
	jobSpawn,
	type PieceCheckJob,
} from "./piece-check-jobs.ts";
import { pieceCheckPlanCreate } from "./piece-check-plan.ts";
import {
	pieceIsKnown,
	pieceNames,
	pieceRemovals,
	pieceSettingsRead,
	pieceSignsFind,
} from "./pieces.ts";

const usage = `Usage: pnpm piece-check [--skip-tree] [<piece>...]

Proves that every installed Piece can still be removed: ${pieceNames.join(", ")}.
Name Pieces to check only those.

  --skip-tree  do not check the unmodified tree first (CI runs one Piece per job and
               its check and unit jobs already run on HEAD)
  -h, --help   this help`;

const main = async () => {
	const directory = process.cwd();
	const script = import.meta.filename;
	// --job is how it runs each check in a child process of its own; it is not for people.
	const parsed = argsParse({
		allowPositionals: true,
		options: {
			job: { type: "string" },
			"skip-tree": { type: "boolean" },
		},
		usage,
	});
	if (parsed === undefined) return;
	if (parsed.values.job !== undefined) {
		const failed = jobRun(
			directory,
			JSON.parse(parsed.values.job) as PieceCheckJob,
		);
		if (failed !== undefined) {
			console.error(failed.text);
			process.exitCode = failed.code;
		}
		return;
	}
	const requested = parsed.positionals.filter(pieceIsKnown);
	const unknown = parsed.positionals.filter((p) => !pieceIsKnown(p));
	if (unknown.length > 0) {
		console.error(
			`piece-check: unknown Piece ${unknown.join(", ")}; Pieces are ${pieceNames.join(", ")}`,
		);
		process.exitCode = 1;
		return;
	}
	let kept: string[];
	try {
		kept = pieceSettingsRead(directory).kept;
	} catch (error) {
		console.error(`piece-check: ${(error as Error).message}`);
		process.exitCode = 1;
		return;
	}
	const plan = pieceCheckPlanCreate({
		installed: pieceSignsFind(directory),
		kept,
		refusal: (piece) => pieceRemovals[piece].refusal?.(directory),
		requested,
	});
	for (const note of plan.notes) console.log(`piece-check: ${note}`);
	if (plan.checks.length === 0) return;
	// The unmodified tree is checked first, alone. When it fails, no piece is to blame. Its install
	// also fills the pnpm store, so the pieces' installs, two at a time, only link from it: two
	// installs downloading into an empty store at once can fail on the same file.
	if (parsed.values["skip-tree"] !== true) {
		const tree = await jobSpawn({
			directory,
			job: { tree: true },
			script,
		}).catch(
			(error): JobEnd => ({ outcome: "crashed", output: String(error) }),
		);
		if (tree.outcome === "failed" || tree.outcome === "unchecked") {
			console.error(tree.output);
			process.exitCode = 1;
			return;
		}
		if (tree.outcome === "crashed") {
			console.error(
				`piece-check: the check of the unmodified tree stopped before it ended, so no piece is to blame. Run it again.\n${tree.output}`,
			);
			process.exitCode = 1;
			return;
		}
	}
	// Each job's end, in the order the plan lists them. Output of each piece that fails or could
	// not be checked is printed whole at the end.
	const ends = new Array<JobEnd>(plan.checks.length);
	await eachConcurrently({
		each: async ([at, job]) => {
			const started = Date.now();
			const end = await jobSpawn({ directory, job, script }).catch(
				(error): JobEnd => ({ outcome: "crashed", output: String(error) }),
			);
			ends[at] = end;
			const seconds = Math.round((Date.now() - started) / 1000);
			if (end.outcome === "passed") {
				console.log(
					`piece-check: ${job.piece} passes check and test without it (${seconds} s)`,
				);
				return;
			}
			console.log(
				end.outcome === "failed"
					? `piece-check: ${job.piece} fails (${seconds} s)`
					: `piece-check: ${job.piece} could not be checked (${seconds} s)`,
			);
		},
		items: plan.checks.map((job, at) => [at, job] as const),
		// Each check runs tsc and vitest across every CPU, so more at once fight for them: on a
		// 4-CPU CI runner four at once ran slower than one at a time, and two at once a little faster.
		limit: Math.min(2, availableParallelism()),
	});
	const ended = (outcome: JobEnd["outcome"]) =>
		plan.checks.flatMap(({ piece }, at) =>
			ends[at]?.outcome === outcome
				? [{ output: ends[at]?.output ?? "", piece }]
				: [],
		);
	const failures = ended("failed");
	const unchecked = ended("unchecked");
	const crashes = ended("crashed");
	for (const { output } of [...failures, ...unchecked, ...crashes]) {
		console.error(output);
	}
	if (failures.length > 0) {
		console.error(
			`piece-check: ${failures.map((e) => e.piece).join(", ")} can no longer be removed. Wrap the code that uses it in piece markers (docs/agents/pieces.md), or list the Piece in piecesKept in .template.json if this Project keeps it.`,
		);
	}
	if (unchecked.length > 0) {
		console.error(
			`piece-check: ${unchecked.map((e) => e.piece).join(", ")} could not be checked (its install or a package manager step failed), which blames no piece. Run it again.`,
		);
	}
	if (crashes.length > 0) {
		console.error(
			`piece-check: the check of ${crashes.map((e) => e.piece).join(", ")} stopped before it ended (a crash or a kill, often out of memory), which blames no piece. Run it again.`,
		);
	}
	if (failures.length + unchecked.length + crashes.length > 0)
		process.exitCode = 1;
};

if (import.meta.main) await main();
