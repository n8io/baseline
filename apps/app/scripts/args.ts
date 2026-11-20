// The command line every script that takes arguments shares. Not a command: importing it runs nothing.
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";

// What argsParse reads: the options a command declares, without `help`, which every command has.
type Parsed<Options extends ParseArgsOptionsConfig> = {
	positionals: string[];
	values: ReturnType<
		typeof parseArgs<{ allowPositionals: true; options: Options; strict: true }>
	>["values"];
};

// Reads a command's arguments with `node:util` parseArgs, strictly, and adds -h and --help.
// `--help` prints the usage text (it starts "Usage:") to stdout and returns undefined. An argument
// parseArgs refuses prints the error and the usage to stderr, sets process.exitCode to 1 and
// returns undefined. A command that gets undefined has already said everything and returns.
export const argsParse = <const Options extends ParseArgsOptionsConfig>({
	allowPositionals = false,
	args = process.argv.slice(2),
	options,
	usage,
}: {
	allowPositionals?: boolean;
	args?: string[];
	options: Options;
	usage: string;
}): Parsed<Options> | undefined => {
	try {
		const parsed = parseArgs({
			allowPositionals,
			args,
			options: { ...options, help: { short: "h", type: "boolean" } },
			strict: true,
		});
		if ((parsed.values as { help?: boolean }).help === true) {
			console.log(usage);
			return undefined;
		}
		return parsed as unknown as Parsed<Options>;
	} catch (error) {
		const command = /^Usage: pnpm ([\w:-]+)/.exec(usage)?.[1];
		const prefix = command === undefined ? "" : `${command}: `;
		console.error(`${prefix}${(error as Error).message}\n\n${usage}`);
		process.exitCode = 1;
		return undefined;
	}
};

// Says the arguments do not fit the command: the usage text on stderr, exit code 1.
export const argsUsageFail = (usage: string): void => {
	console.error(usage);
	process.exitCode = 1;
};
