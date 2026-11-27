// template-upgrade's commits: stores a rendered tree as a commit in the Project's repository and
// cherry-picks the change between two renders into its working tree.
import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Piece, piecesRemoveFromTree } from "./pieces.ts";
import { gitRun, processRun } from "./process-run.ts";
import { filesWrite, type TemplateFile } from "./template-render.ts";

export type UpgradeTools = {
	fetch: (version: string) => Promise<TemplateFile[]> | TemplateFile[];
	// Formats the render and regenerates its env types; tests skip it.
	finish: (directory: string) => void;
};

// Stores a rendered tree as a commit in the Project's repository, without touching its index.
const renderCommit = ({
	files,
	message,
	parent,
	removed,
	repository,
	tools,
}: {
	files: TemplateFile[];
	message: string;
	parent?: string | null;
	// The Pieces the Project removed; the render drops them too.
	removed: Piece[];
	repository: string;
	tools: UpgradeTools;
}): string => {
	using work = mkdtempDisposableSync(join(tmpdir(), "template-render-"));
	const tree = join(work.path, "tree");
	filesWrite(tree, files);
	piecesRemoveFromTree(tree, removed);
	tools.finish(tree);
	const env = { ...process.env, GIT_INDEX_FILE: join(work.path, "index") };
	// Unlike gitRun, it works on the Project's repository with the rendered tree as its work tree
	// and a private index, so the Project's own index and files stay as they are.
	const treeGitRun = (args: string[]) =>
		processRun({
			command: "git",
			args: [
				"--git-dir",
				join(repository, ".git"),
				"--work-tree",
				tree,
				...args,
			],
			options: {
				cwd: tree,
				env,
			},
		}).trim();
	treeGitRun(["add", "--all", "--force", "."]);
	const treeId = treeGitRun(["write-tree"]);
	return treeGitRun([
		"commit-tree",
		treeId,
		"-m",
		message,
		...(parent === undefined || parent === null ? [] : ["-p", parent]),
	]);
};

// The paths git left unmerged after the cherry-pick.
const conflictsRead = (repository: string): string[] =>
	gitRun(repository, ["diff", "--name-only", "--diff-filter=U"])
		.split("\n")
		.filter((path) => path !== "");

// Applies the change between two renders to the Project's working tree.
export const templateMerge = ({
	from,
	labels,
	removed,
	repository,
	to,
	tools,
}: {
	from: TemplateFile[];
	labels: { from: string; to: string };
	removed: Piece[];
	repository: string;
	to: TemplateFile[];
	tools: UpgradeTools;
}): { conflicts: string[] } => {
	const base = renderCommit({
		repository,
		files: from,
		removed,
		tools,
		message: `template ${labels.from}`,
	});
	const next = renderCommit({
		repository,
		files: to,
		removed,
		tools,
		message: `template ${labels.to}`,
		parent: base,
	});
	try {
		// A conflict is reported below; gitRun keeps git's own "could not apply" hints quiet.
		gitRun(repository, ["cherry-pick", "--no-commit", next]);
	} catch (error) {
		// A conflict exits non-zero and leaves unmerged paths; anything else is a real failure.
		const conflicts = conflictsRead(repository);
		if (conflicts.length === 0) throw error;
		return { conflicts };
	}
	return { conflicts: [] };
};
