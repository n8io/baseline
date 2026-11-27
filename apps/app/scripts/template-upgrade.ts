// pnpm template-upgrade [--to <version>]: renders the Project's Template release and the new one
// with the saved answers, stores both as commits and cherry-picks the difference without
// committing: a 3-way merge that leaves standard conflict markers and exits 1 on a conflict.
// The code lives in template-upgrade-*.ts modules, one per concern, and this file keeps the CLI and
// re-exports their names.
import { argsParse } from "./args.ts";
import { npmTarballsWait } from "./npm-tarballs-wait.ts";
import { processRun } from "./process-run.ts";
import {
	releaseLatest,
	templateFetchOwn,
	templateFinish,
} from "./template-render.ts";
import { templateUpgradeRun } from "./template-upgrade-run.ts";

export type { UpgradeTools } from "./template-upgrade-commit.ts";
export {
	type DroppedImport,
	droppedImportsFind,
} from "./template-upgrade-imports.ts";
export {
	changelogBetween,
	languageKeep,
	releaseRender,
	secretKeep,
	workspaceExcludesDedupe,
} from "./template-upgrade-keep.ts";
export { templateUpgrade } from "./template-upgrade-plan.ts";
export { templateUpgradeRun };

const usage = `Usage: pnpm template-upgrade [--to <version>]

Renders the Project's Template release and the new one, and merges the difference into the working
tree without committing. Exits 1 on a conflict.

  --to <version>  the release to upgrade to (default: the latest)
  -h, --help      this help`;

const main = async () => {
	const parsed = argsParse({ options: { to: { type: "string" } }, usage });
	if (parsed === undefined) return;
	const { values } = parsed;
	const appDirectory = process.cwd();
	process.exitCode = await templateUpgradeRun({
		appDirectory,
		to: values.to ?? releaseLatest(),
		tools: {
			fetch: (version) => templateFetchOwn(version),
			finish: (directory) => templateFinish(directory, appDirectory),
		},
		pnpm: (args) => {
			processRun({
				command: "pnpm",
				args,
				options: { cwd: appDirectory, inherit: true },
			});
		},
		tarballsWait: () => npmTarballsWait({ directory: appDirectory }),
	});
};

if (import.meta.main) await main();
