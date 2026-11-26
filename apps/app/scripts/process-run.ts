// Runs the commands the scripts shell out to. Not a command: other scripts import it.
// template-render-process.ts keeps its own private copy of processRun, because template-upgrade loads the
// template-render modules alone (releaseRender) and so they import nothing local.
import { execFileSync } from "node:child_process";

// Runs a command and returns its stdout. Its stderr is kept out of the terminal: a failure's error
// carries it, so a run that works prints nothing alarming. `inherit` shows all its output instead.
export const processRun = ({
	args,
	command,
	options,
}: {
	args: string[];
	command: string;
	options?: {
		cwd?: string | null;
		env?: NodeJS.ProcessEnv | null;
		inherit?: boolean | null;
		input?: string | null;
	} | null;
}): string =>
	execFileSync(command, args, {
		cwd: options?.cwd ?? undefined,
		encoding: "utf8",
		env: options?.env ?? process.env,
		input: options?.input ?? undefined,
		maxBuffer: 256 * 1024 * 1024,
		stdio: options?.inherit ? "inherit" : "pipe",
	}) ?? "";

// Runs `git <args>` in a directory and returns its stdout as git printed it.
export const gitRun = (directory: string, args: string[]): string =>
	processRun({ command: "git", args, options: { cwd: directory } });
