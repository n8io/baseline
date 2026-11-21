import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseEnv } from "node:util";
import { argsParse } from "./args.ts";
import { devInstanceFile, devInstanceNameCreate } from "./dev-instance.ts";
import { gitRun, processRun } from "./process-run.ts";

// `pnpm dev:prune [--dry-run]` removes the containers and volumes of this Project's dev instances
// (scripts/dev-instance.ts) whose linked worktree is gone. Compose labels each container with the
// folder it ran in; an instance is gone when that folder no longer exists, its name is the one
// dev-instance gives that folder, and no listed worktree uses that name. So it never removes a
// running checkout's stack, another Project's, or an instance renamed in its .env.development.local:
// `pnpm dev:reset` that one before removing its worktree. Volumes whose containers are already gone
// carry no folder, so it does not find them.
export type DevInstanceContainer = { directory: string; name: string };

export const devInstancesStale = (
	directory: string,
	containers: DevInstanceContainer[],
): string[] => {
	const { name: project } = JSON.parse(
		readFileSync(join(directory, "package.json"), "utf8"),
	) as { name: string };
	// The app's folder in its repository: "/apps/app" in the Template's, "" in a Project's.
	const [prefix = ""] = gitRun(directory, ["rev-parse", "--show-prefix"])
		.trim()
		.split("\n");
	const suffix = prefix && `/${prefix.replace(/\/$/, "")}`;
	// The instance names in use: every worktree git lists with its folder, by its file and by its name.
	const live = new Set([project]);
	for (const block of gitRun(directory, ["worktree", "list", "--porcelain"])
		.trim()
		.split("\n\n")) {
		const worktree = block.split("\n")[0]?.slice("worktree ".length) ?? "";
		if (/^prunable/m.test(block)) continue;
		const file = join(worktree + suffix, devInstanceFile);
		const text = existsSync(file) ? readFileSync(file, "utf8") : "";
		live.add(parseEnv(text)["COMPOSE_PROJECT_NAME"] ?? "");
		live.add(devInstanceNameCreate(project, basename(worktree)));
	}
	const stale = containers.filter(
		({ directory: ran, name }) =>
			!live.has(name) &&
			ran.endsWith(suffix) &&
			!existsSync(ran) &&
			name ===
				devInstanceNameCreate(
					project,
					basename(ran.slice(0, ran.length - suffix.length)),
				),
	);
	return [...new Set(stale.map(({ name }) => name))];
};

const usage = `Usage: pnpm dev:prune [--dry-run]

Removes the containers and volumes of this Project's dev instances whose linked worktree is gone.

  --dry-run   list what it would remove
  -h, --help  this help`;

const main = () => {
	const parsed = argsParse({
		options: { "dry-run": { type: "boolean" } },
		usage,
	});
	if (parsed === undefined) return;
	const dryRun = parsed.values["dry-run"] === true;
	// Each container's compose project and the folder compose ran in; a container compose did not
	// start has neither label.
	const label = "com.docker.compose.project";
	const format = `{{.Label "${label}"}}\t{{.Label "${label}.working_dir"}}`;
	const containers = processRun({
		command: "docker",
		args: ["ps", "--all", "--format", format],
	})
		.split("\n")
		.map((line) => line.split("\t"))
		.map(([name = "", directory = ""]) => ({ directory, name }));
	const stale = devInstancesStale(process.cwd(), containers);
	if (stale.length === 0)
		console.info("dev:prune: no dev instance of a removed worktree");
	for (const name of stale) {
		console.info(`dev:prune: ${dryRun ? "would remove" : "removing"} ${name}`);
		// From the temp folder compose loads no project file and finds the project's containers,
		// volumes and network by label; COMPOSE_PROJECT_NAME names it, as varlock does for `pnpm dev`.
		if (!dryRun) {
			processRun({
				command: "docker",
				args: ["compose", "down", "--volumes"],
				options: {
					cwd: tmpdir(),
					env: { ...process.env, COMPOSE_PROJECT_NAME: name },
					inherit: true,
				},
			});
		}
	}
};

if (import.meta.main) main();
