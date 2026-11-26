// pnpm app-create's steps in order: the questions, the render, then the GitHub half.
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	templateAnswers,
	templateJsonRead,
} from "../apps/app/scripts/template-render.ts";
import { appCreateArgsRead } from "./app-create-args.ts";
import { githubCreate } from "./app-create-github.ts";
import { monorepo } from "./app-create-release.ts";
import {
	answersAsk,
	directoryStart,
	projectRender,
} from "./app-create-render.ts";
import { requiredJobs } from "./app-create-ruleset.ts";

const githubSteps = ({
	description,
	directory,
	name,
	owner,
}: {
	description: string;
	directory: string;
	name: string;
	owner: string | null;
}): string =>
	[
		"The GitHub half, on a machine where `gh auth status` is signed in:",
		`  1. gh repo create ${owner ?? "<owner>"}/${name} --private --description '${description.replaceAll("'", "'\\''")}' --source ${directory} --remote origin --push`,
		`  2. a ruleset on the default branch: no deletion, no force push, squash-merged pull requests only, and ${requiredJobs.map((job) => `ci / ${job}`).join(", ")} required`,
		"  3. squash-only merging with merged branches deleted",
		"  4. Dependabot alerts, then Dependabot security updates",
		`Inside ${directory}, \`pnpm -C ${monorepo} app-create --github-only\` does all four and runs CI once on main.`,
	].join("\n");

const nextSteps = (directory: string): string =>
	[
		`Next: cd ${directory} && pnpm dev`,
		"Then add your first context's row to CONTEXT-MAP.md, run `pnpm context-create <context>`, add its Model's term to the context's CONTEXT.md, then `pnpm model-create <context> <model> --bare` (docs/agents/context-create.md).",
	].join("\n");

export const appCreateRun = async () => {
	const args = appCreateArgsRead(process.argv.slice(2));
	if (args.mode === "github") {
		const directory = directoryStart();
		if (!existsSync(join(directory, ".template.json"))) {
			throw new Error(
				`${directory} is not a render: run --github-only inside the folder app-create made`,
			);
		}
		const { description, name } = templateAnswers(
			directory,
			templateJsonRead(directory),
		);
		await githubCreate({ description, directory, name, owner: args.owner });
		console.log(nextSteps(directory));
		return;
	}
	const answers = await answersAsk(args);
	const directory = await projectRender(answers, args.without);
	if (args.mode === "render") {
		console.log(
			`Rendered and committed ${directory}; nothing exists on GitHub yet.`,
		);
		console.log(githubSteps({ ...answers, directory, owner: args.owner }));
	} else {
		await githubCreate({ ...answers, directory, owner: args.owner });
	}
	console.log(nextSteps(directory));
};
