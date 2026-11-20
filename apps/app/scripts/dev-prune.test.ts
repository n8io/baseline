// Reads and runs no file of the app, only its imports and temporary git checkouts.
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempDisposableSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { devInstancesStale } from "./dev-prune.ts";

const git = (directory: string, ...args: string[]) =>
	execFileSync("git", args, { cwd: directory, stdio: "ignore" });

// A repository with the Project "invoicing" in `app` ("" for its root), two linked worktrees of it,
// and the app folder of each checkout.
const checkoutsCreate = (root: string, app: string) => {
	const original = join(root, "invoicing");
	mkdirSync(join(original, app), { recursive: true });
	writeFileSync(join(original, app, "package.json"), '{"name":"invoicing"}\n');
	git(original, "init", "-q");
	git(original, "add", ".");
	git(
		original,
		"-c",
		"user.name=t",
		"-c",
		"user.email=t@t",
		"commit",
		"-qm",
		"one",
	);
	for (const folder of ["Live", "Gone"]) {
		git(original, "worktree", "add", "-q", join(root, folder));
	}
	return {
		gone: join(root, "Gone", app),
		live: join(root, "Live", app),
		original: join(original, app),
	};
};

describe("devInstancesStale", () => {
	it("names only the instance of a removed worktree", () => {
		using root = mkdtempDisposableSync(join(tmpdir(), "dev-prune-"));
		const { gone, live, original } = checkoutsCreate(root.path, "apps/app");
		git(original, "worktree", "remove", join(root.path, "Gone"));
		mkdirSync(join(root.path, "billing/apps/app"), { recursive: true });
		writeFileSync(
			join(live, ".env.development.local"),
			"COMPOSE_PROJECT_NAME=invoicing-old\n",
		);

		expect(
			devInstancesStale(live, [
				{ directory: original, name: "invoicing" },
				{ directory: live, name: "invoicing-live" },
				{ directory: gone, name: "invoicing-gone" },
				{ directory: gone, name: "invoicing-gone" },
				// Renamed in its .env.development.local: not known as this Project's.
				{ directory: gone, name: "mine" },
				// Another Project whose name starts with this one's.
				{
					directory: join(root.path, "invoicing-billing", "apps/app"),
					name: "invoicing-billing",
				},
				// Another Project, in a folder whose name completes this Project's.
				{
					directory: join(root.path, "billing/apps/app"),
					name: "invoicing-billing",
				},
				// A worktree moved from Old, which keeps its name in its file.
				{ directory: join(root.path, "Old/apps/app"), name: "invoicing-old" },
				// A live worktree's name, from a path git does not list (a symlink).
				{
					directory: join(root.path, "link/Live/apps/app"),
					name: "invoicing-live",
				},
				// The original checkout's name, from a folder that names no instance.
				{ directory: join(root.path, "___/apps/app"), name: "invoicing" },
			]),
		).toEqual(["invoicing-gone"]);
		// The removed worktree's name, but compose ran in another folder of it.
		expect(
			devInstancesStale(live, [
				{ directory: join(root.path, "Gone/apps/web"), name: "invoicing-gone" },
			]),
		).toEqual([]);
	});

	it("takes a deleted worktree folder git still lists for removed", () => {
		using root = mkdtempDisposableSync(join(tmpdir(), "dev-prune-"));
		const { gone, live, original } = checkoutsCreate(root.path, "");
		rmSync(gone, { force: true, recursive: true });
		const containers = [
			{ directory: original, name: "invoicing" },
			{ directory: live, name: "invoicing-live" },
			{ directory: gone, name: "invoicing-gone" },
		];

		expect(devInstancesStale(original, containers)).toEqual(["invoicing-gone"]);
	});
});
