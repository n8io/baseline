import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseEnv } from "node:util";
import { hostPortsCreate } from "./template-render.ts";

// A linked git worktree is its own dev instance, so several worktrees of one Project run `pnpm dev`
// at once with their own containers, volumes, ports and cookies. `pnpm dev` and `pnpm dev:reset`
// run this first. The original checkout is the Project's own instance: its name and committed ports.
// In a linked worktree it adds the instance's compose project and ports to .env.development.local,
// once, and never changes a line there: change a port in it on a clash.
export const devInstanceFile = ".env.development.local";

const git = (directory: string, ...args: string[]): string[] =>
	execFileSync("git", args, {
		cwd: directory,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	})
		.trim()
		.split("\n");

// `<project>-<worktree folder>` in what a compose project name allows: a-z, 0-9 and hyphens.
export const devInstanceNameCreate = (project: string, folder: string) =>
	`${project}-${folder}`
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-|-$/g, "");

// A linked worktree's git dir is its own; the original checkout's is the common one. Without git
// (a copy, no git binary) it is the original checkout.
export const devInstanceLinkedIs = (directory: string): boolean => {
	try {
		const [gitDir, commonDir] = git(
			directory,
			"rev-parse",
			"--path-format=absolute",
			"--git-dir",
			"--git-common-dir",
		);
		return gitDir !== commonDir;
	} catch {
		return false;
	}
};

// The instance's compose project name, writing its lines first when the file has none; undefined
// in the original checkout.
export const devInstanceWrite = (directory: string): string | undefined => {
	if (!devInstanceLinkedIs(directory)) return undefined;
	const path = join(directory, devInstanceFile);
	const text = existsSync(path) ? readFileSync(path, "utf8") : "";
	const written = parseEnv(text).COMPOSE_PROJECT_NAME;
	if (written) return written;
	const manifest = JSON.parse(
		readFileSync(join(directory, "package.json"), "utf8"),
	) as { name: string };
	const [toplevel = directory] = git(directory, "rev-parse", "--show-toplevel");
	const name = devInstanceNameCreate(manifest.name, basename(toplevel));
	// A folder name with no a-z or 0-9 would give the original checkout's name, stack and ports.
	if (name === devInstanceNameCreate(manifest.name, "")) {
		throw new Error(
			`dev-instance: name the worktree folder with a letter or digit, or set COMPOSE_PROJECT_NAME in ${devInstanceFile}`,
		);
	}
	// Only the ports this Project still declares (removing the redis piece drops REDIS_HOST_PORT).
	const declared = parseEnv(
		readFileSync(join(directory, ".env.schema"), "utf8"),
	);
	const ports = Object.entries(hostPortsCreate(name)).filter(
		([item]) => item in declared,
	);
	appendFileSync(
		path,
		[
			text === "" || text.endsWith("\n") ? "" : "\n",
			"# This worktree's dev instance (scripts/dev-instance.ts). The Worker serves on HEALTH_PORT + 1.\n",
			`COMPOSE_PROJECT_NAME=${name}\n`,
			...ports.map(([item, port]) => `${item}=${port}\n`),
		].join(""),
	);
	console.info(`dev-instance: ${name}, its ports in ${devInstanceFile}`);
	return name;
};

if (import.meta.main) devInstanceWrite(process.cwd());
