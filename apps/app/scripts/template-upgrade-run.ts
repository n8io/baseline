// template-upgrade's CLI steps after parsing: the messages and the exit code.
import { templateJsonRead } from "./template-render.ts";
import type { UpgradeTools } from "./template-upgrade-commit.ts";
import { templateUpgrade } from "./template-upgrade-plan.ts";

// The CLI's steps after parsing; returns the exit code.
export const templateUpgradeRun = async ({
	appDirectory,
	output,
	pnpm,
	tarballsWait,
	to,
	tools,
}: {
	appDirectory: string;
	/** Where the messages go; the console when left out. */
	output?: {
		error: (line: string) => void;
		log: (line: string) => void;
	} | null;
	pnpm: (args: string[]) => void;
	/** Resolves once npm serves every @n8io/baseline-* tarball the lockfile names. */
	tarballsWait: () => Promise<void>;
	to: string;
	tools: UpgradeTools;
}): Promise<number> => {
	const { error: logError, log } = output ?? console;
	let result: Awaited<ReturnType<typeof templateUpgrade>>;
	try {
		if (templateJsonRead(appDirectory).release === to) {
			log(`template-upgrade: already on release ${to}; nothing to upgrade`);
			return 0;
		}
		result = await templateUpgrade({ appDirectory, to, tools });
	} catch (error) {
		logError(`template-upgrade: ${(error as Error).message}`);
		return 1;
	}
	log(
		`Template changes up to ${to} (apply foo changes to your contexts by hand):\n\n${result.changelog || "(no changelog entries)"}\n`,
	);
	if (result.renamed.length > 0) {
		log(
			`template-upgrade: followed the Template's renames in ${result.renamed.length} of your files:\n${result.renamed.map((path) => `  ${path}`).join("\n")}\n`,
		);
	}
	if (result.conflicts.length > 0) {
		// The format step below never runs, so give .template.json Biome's layout now; the files
		// with conflict markers cannot be formatted until they are resolved. A conflict in
		// biome.json or package.json stops Biome too: then the message asks for pnpm format.
		let steps = "pnpm install, pnpm check and pnpm test";
		try {
			pnpm(["exec", "biome", "format", "--write", ".template.json"]);
		} catch {
			steps = "pnpm install, pnpm format, pnpm check and pnpm test";
		}
		const lost = result.lost
			.map(
				({ lines, path }) =>
					`  ${path}:\n${lines
						.slice(0, 8)
						.map((line) => `    ${line.trim()}`)
						.join(
							"\n",
						)}${lines.length > 8 ? `\n    (${lines.length - 8} more)` : ""}`,
			)
			.join("\n");
		logError(
			`template-upgrade: conflicts in ${result.conflicts.join(", ")}. The merge is left staged in your working tree (nothing is committed, and .template.json has moved), so do not run template-upgrade again: resolve the markers in each file, then run ${steps}, then commit.${lost === "" ? "" : `\nYour side has these lines the Template's side lacks; keep each one you still want:\n${lost}\n`} If the install answers 404 for an @n8io/baseline-* tarball, npm is still publishing the release: wait a few minutes and run it again.`,
		);
		return 1;
	}
	if (result.dropped.length > 0) {
		logError(
			`template-upgrade: merged, but the Template dropped ${result.dropped.length === 1 ? "a dependency" : "dependencies"} your code still imports, and the install would prune ${result.dropped.length === 1 ? "it" : "them"}:\n${result.dropped.map(({ name, paths }) => `  ${name} (${paths.join(", ")})`).join("\n")}\nPut each back: \`pnpm add ${result.dropped.map(({ name, range }) => `${name}@${range}`).join(" ")}\`, and its line in dependencies-allowed.json (the Template's removal took that out too). Then run pnpm install, pnpm format, pnpm check and pnpm test. .template.json has moved, so running template-upgrade again does nothing.`,
		);
		return 1;
	}
	// The merge can pin a release published minutes ago, whose tarball npm answers 404 for
	// first: resolve the lockfile, wait for the tarballs, then install.
	try {
		pnpm(["install", "--lockfile-only"]);
		await tarballsWait();
	} catch (error) {
		logError(
			`template-upgrade: merged, but the install could not start: ${(error as Error).message}\nThe merge is done and .template.json has moved, so running template-upgrade again does nothing. Run pnpm install, pnpm format, pnpm check and pnpm test yourself.`,
		);
		return 1;
	}
	try {
		for (const script of ["install", "format", "check", "test"]) pnpm([script]);
	} catch {
		logError("template-upgrade: merged, but format, typecheck or tests fail");
		return 1;
	}
	log("template-upgrade: merged; review the changes and commit them");
	return 0;
};
