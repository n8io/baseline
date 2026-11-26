// Runs the commands template-render shells out to. A private copy of process-run.ts: template-upgrade
// loads the template-render modules from a release alone (releaseRender), so they import nothing
// from the rest of scripts/. Keep the two in step.
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
