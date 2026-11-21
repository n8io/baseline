import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const app = join(import.meta.dirname, "cli-test-app.ts");

/** What `cliTestProcessRun` takes. */
type CliTestProcessRunOptions = {
	args: string[];
	/** The config directory this run gets as XDG_CONFIG_HOME. */
	config: string;
	env?: Record<string, string>;
	stdin?: string;
};

/** What a fixture CLI run printed and exited with. */
type CliTestProcessRunResult = { code: number; stderr: string; stdout: string };

/** Runs the fixture CLI as its own process, with a config directory of its own. */
export const cliTestProcessRun = async ({
	args,
	config,
	env = {},
	stdin,
}: CliTestProcessRunOptions): Promise<CliTestProcessRunResult> => {
	const run = promisify(execFile)(process.execPath, [app, ...args], {
		env: { PATH: process.env["PATH"] ?? "", XDG_CONFIG_HOME: config, ...env },
	});
	run.child.stdin?.end(stdin ?? "");
	return run.then(
		({ stdout, stderr }) => ({ code: 0, stderr, stdout }),
		(error: { code: number; stderr: string; stdout: string }) => ({
			code: error.code,
			stderr: error.stderr,
			stdout: error.stdout,
		}),
	);
};
