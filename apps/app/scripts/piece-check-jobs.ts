// The jobs piece-check runs: one per child process, how each ends, and how many run at once.
import { spawn } from "node:child_process";
import {
	type PieceCheckFailure,
	pieceCheck,
	treeCheck,
} from "./piece-check-run.ts";
import type { Piece } from "./pieces.ts";

// One unit of work for a child process: the unmodified tree, or a piece.
export type PieceCheckJob = { tree: true } | { first: Piece[]; piece: Piece };

// A child exits with this code when its check fails. Any other ending (a throw, a kill, no
// memory) says nothing about a piece, so it blames none.
const checkFailedCode = 3;

// A child exits with this code when its install, `pnpm remove` or `pnpm add` failed, so no check ran and no piece is to blame.
const checkUnreadyCode = 4;

// What a job prints and how it exits when its check fails; undefined when it passes.
export const pieceCheckFailureReport = (
	piece: string,
	failed: PieceCheckFailure | undefined,
): { code: number; text: string } | undefined => {
	if (failed === undefined) return undefined;
	const tail = failed.output.split("\n").slice(-40).join("\n");
	if (failed.unchecked === true) {
		return {
			code: checkUnreadyCode,
			text: `piece-check: ${piece} could not be checked: ${failed.step} failed in its worktree before any check ran, so no piece is to blame. Run it again.\n${tail}`,
		};
	}
	return {
		code: checkFailedCode,
		text: [
			`piece-check: ${piece} fails at ${failed.step}.`,
			failed.files.length > 0
				? `Code that uses ${piece} outside its piece markers, or fails without it:\n${failed.files.map((f) => `  ${f}`).join("\n")}`
				: "",
			tail,
		]
			.filter((part) => part !== "")
			.join("\n"),
	};
};

// Runs one job in this process and returns why it fails, if it does.
export const jobRun = (
	directory: string,
	job: PieceCheckJob,
): { code: number; text: string } | undefined => {
	if ("tree" in job) {
		const broken = treeCheck(directory);
		if (broken === undefined) return undefined;
		const tail = broken.output.split("\n").slice(-40).join("\n");
		return broken.unchecked === true
			? {
					code: checkUnreadyCode,
					text: `piece-check: the unmodified tree could not be checked: ${broken.step} failed before any check ran, so no piece is to blame. Run it again.\n${tail}`,
				}
			: {
					code: checkFailedCode,
					text: `piece-check: fix the tree first: ${broken.step} fails on HEAD before any piece is removed, so no piece is to blame.\n${tail}`,
				};
	}
	return pieceCheckFailureReport(job.piece, pieceCheck(directory, job));
};

export type JobEnd = {
	outcome: "crashed" | "failed" | "passed" | "unchecked";
	output: string;
};

// How a child process ended: its exit code says whether its check passed, failed, or could not run.
export const jobEndRead = ({
	code,
	output,
	signal,
}: {
	code: number | null;
	output: string;
	signal: NodeJS.Signals | null;
}): JobEnd => {
	const text = output.trim();
	if (code === 0) return { outcome: "passed", output: text };
	if (code === checkFailedCode) return { outcome: "failed", output: text };
	if (code === checkUnreadyCode) return { outcome: "unchecked", output: text };
	return {
		outcome: "crashed",
		output:
			`${text}\n(the check ended with ${signal ?? `exit code ${code}`})`.trim(),
	};
};

// Runs one job in a child process of this script, keeping its output until it ends.
export const jobSpawn = ({
	directory,
	job,
	script,
}: {
	directory: string;
	job: PieceCheckJob;
	script: string;
}) =>
	new Promise<JobEnd>((done) => {
		const child = spawn(
			process.execPath,
			[...process.execArgv, script, "--job", JSON.stringify(job)],
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
			done(jobEndRead({ code, output, signal }));
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
	// One shared iterator: each lane takes the next item when it frees up.
	const waiting = items.values();
	const lane = async () => {
		for (const item of waiting) await each(item);
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, lane),
	);
};
