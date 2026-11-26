// pnpm app-create: makes a new Project from the latest app@ release, with no bounded context yet.
// Renders apps/app, writes the Project's answers, installs and commits, then creates the private
// GitHub repository, the CI ruleset, squash-only merging and Dependabot security updates, and runs CI once on main.
// --no-github stops after the commit; --github-only does the GitHub half inside an existing render.
// Flags skip the questions: --name --description [--owner]. docs/agents/project-create.md.
// --without a,b removes those Pieces (apps/app/scripts/pieces.ts) from the new Project right after its first commit.
import { appCreateRun } from "./app-create-run.ts";

export { type AppCreateArgs, appCreateArgsRead } from "./app-create-args.ts";
export {
	ciDispatch,
	mergeSettingsCall,
	repositoryFromRemote,
	securityUpdatesCalls,
} from "./app-create-github.ts";
export {
	baselinePackagesPinned,
	npmVersionsWait,
} from "./app-create-npm.ts";
export { releaseWarning } from "./app-create-release.ts";
export {
	answersWrite,
	appRender,
	envFilesWrite,
	gitCommitAll,
	glossaryTerm,
	piecesRemovalOrder,
	pnpmInheritRun,
	toolsDirectory,
} from "./app-create-render.ts";
export {
	requiredJobs,
	rulesetBodyCreate,
	rulesetChangesFind,
	rulesetReconcile,
} from "./app-create-ruleset.ts";

if (import.meta.main) {
	try {
		await appCreateRun();
	} catch (error) {
		console.error(`app-create: ${(error as Error).message}`);
		process.exitCode = 1;
	}
}
