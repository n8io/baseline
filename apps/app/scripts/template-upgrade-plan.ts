// template-upgrade's merge: renders the Project's Template release and the target, and merges the
// difference into the working tree without committing.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conflictOwnLines } from "./conflict-report.ts";
import { contextMapKeep } from "./context-map-keep.ts";
import { piecesRemovedFind } from "./pieces.ts";
import { gitRun } from "./process-run.ts";
import {
	filesRead,
	type TemplateAnswers,
	type TemplateFile,
	templateAnswers,
	templateJsonRead,
} from "./template-render.ts";
import { templateMerge, type UpgradeTools } from "./template-upgrade-commit.ts";
import {
	type DroppedImport,
	droppedImportsFind,
	importFileIsScanned,
} from "./template-upgrade-imports.ts";
import {
	changelogBetween,
	languageKeep,
	releaseRender,
	secretKeep,
	workspaceExcludesDedupe,
} from "./template-upgrade-keep.ts";
import {
	pieceInRelease,
	piecesRemovedWith,
	renamesFollow,
} from "./template-upgrade-pieces.ts";

const sdkGeneratedPaths = ["clients/sdk/openapi.json", "clients/sdk/sdk.ts"];

export const templateUpgrade = async ({
	appDirectory,
	to,
	tools,
}: {
	appDirectory: string;
	to: string;
	tools: UpgradeTools;
}): Promise<{
	conflicts: string[];
	changelog: string;
	dropped: DroppedImport[];
	/** Per conflicted file, the lines only the Project's side has. */
	lost: { lines: string[]; path: string }[];
	/** The files the Template's renames changed in the Project's own code. */
	renamed: string[];
}> => {
	const status = gitRun(appDirectory, ["status", "--porcelain"]);
	if (status.trim() !== "") {
		throw new Error("the working tree has changes; commit or stash them first");
	}
	const template = templateJsonRead(appDirectory);
	const answers: TemplateAnswers = templateAnswers(appDirectory, template);
	const fromFiles = await tools.fetch(template.release);
	const toFiles = await tools.fetch(to);
	// The Project's lockfile is its own after app-create: its next install moves only what changed.
	// So are the SDK's generated files once it has them: pnpm sdk-generate writes them from its API.
	const sdkOwn = existsSync(join(appDirectory, "clients/sdk/openapi.json"));
	const merged = (files: TemplateFile[]) =>
		files.filter(
			(f) =>
				f.path !== "pnpm-lock.yaml" &&
				!(sdkOwn && sdkGeneratedPaths.includes(f.path)),
		);
	const envPath = join(appDirectory, ".env.development");
	const project = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
	const glossaryPath = join(appDirectory, "CONTEXT.md");
	const glossary = existsSync(glossaryPath)
		? readFileSync(glossaryPath, "utf8")
		: "";
	const kept = async (files: TemplateFile[]) =>
		languageKeep({
			files: secretKeep({
				files: await releaseRender(merged(files), answers),
				project,
			}),
			project: glossary,
		});
	const contextMapPath = join(appDirectory, "CONTEXT-MAP.md");
	const renders = contextMapKeep({
		from: await kept(fromFiles),
		to: await kept(toFiles),
		project: existsSync(contextMapPath)
			? readFileSync(contextMapPath, "utf8")
			: "",
	});
	const manifestPath = join(appDirectory, "package.json");
	const manifestBefore = readFileSync(manifestPath, "utf8");
	const { conflicts } = templateMerge({
		repository: appDirectory,
		from: renders.from,
		to: renders.to,
		tools,
		removed: piecesRemovedWith(
			piecesRemovedFind(appDirectory).filter(pieceInRelease(fromFiles)),
		),
		labels: { from: template.release, to },
	});
	const workspace = join(appDirectory, "pnpm-workspace.yaml");
	if (conflicts.length === 0 && existsSync(workspace)) {
		const text = readFileSync(workspace, "utf8");
		writeFileSync(workspace, workspaceExcludesDedupe(text));
	}
	const renamed = renamesFollow({
		appDirectory,
		from: template.release,
		text: toFiles.find((f) => f.path === "template-renames.json")?.text ?? "",
		to,
	});
	const dropped =
		conflicts.length === 0
			? droppedImportsFind({
					before: manifestBefore,
					after: readFileSync(manifestPath, "utf8"),
					files: filesRead(appDirectory).filter(importFileIsScanned),
				})
			: [];
	writeFileSync(
		join(appDirectory, ".template.json"),
		`${JSON.stringify({ ...template, release: to }, null, "\t")}\n`,
	);
	const changelog = toFiles.find((f) => f.path === "CHANGELOG.md")?.text ?? "";
	return {
		changelog: changelogBetween({ changelog, from: template.release, to }),
		conflicts,
		dropped,
		lost: conflicts
			.filter((path) => existsSync(join(appDirectory, path)))
			.map((path) => ({
				path,
				lines: conflictOwnLines(readFileSync(join(appDirectory, path), "utf8")),
			}))
			.filter(({ lines }) => lines.length > 0),
		renamed,
	};
};
