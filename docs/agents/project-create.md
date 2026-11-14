# Walkthrough: create a Project

Read when someone asks to create a new Project, or asks to be walked through it. To start one, ask your agent: "Walk me through creating a Project with docs/agents/project-create.md."

## How to guide

- Take one step at a time. Say what the step does and why, show the command, and run it only after the person says go.
- After each step, show what changed and how to tell it worked. Stop at the first failure and explain it before you try anything else.
- Ask before anything that cannot be undone: creating the GitHub repo is the only such step here.
- End by summarising what now exists and what the person does next.

## Steps

1. **Check the tools.** Node 26 (`fnm use` reads `.node-version`), pnpm from `packageManager`, Docker running, and, for the GitHub half, `gh auth status` logged in. Then `pnpm install` in baseline. Check: `node --version` prints v26.
2. **Choose the answers.** `app-create` asks for two: the Project's name (kebab case, also the repo name) and a one-line description. A new Project has no Domain: its first pull request adds the first one (step 7).
3. **Render.** `pnpm app-create` from baseline, or pass the answers as `--name --description [--owner]`; the Project lands in `./<name>` of the folder you ran it from (`pnpm -C <baseline> app-create` from another folder). It renders the newest `app@` release with that release's own render code, writes `.template.json` (the release it came from, which `pnpm template-upgrade` starts from), a fresh `AUTHN_SECRET` in `.env.development` and the `op://<name>-production` vault in `.env.production`, installs and commits.
   - When baseline main holds changesets the release does not, it says so first ("main holds 3 unreleased changesets; this Project gets app@7.1.0"). A Project made then gets those changes later with `pnpm template-upgrade`.
   - Within minutes of a release, npm may not serve the new `@n8io/baseline-*` versions yet. It then prints one "Waiting for npm" line and checks every 15 seconds for up to 15 minutes before it installs.
   - The install prints "Agent skills awaiting approval" for some dependencies. That is expected and needs nothing.
4. **Repo and ruleset.** The same run creates the private GitHub repo, pushes, adds a ruleset on the default branch that requires every `app-ci.yml` job (`ci / check`, `unit`, `integration`, `migrations`, `oasdiff`, `pieces`, `image`, `sast`), turns on Dependabot alerts and security updates, and runs CI once on main, printing the run's URL. This is the step to confirm first. If it stops earlier, `./<name>` holds the partial render and nothing exists on GitHub yet. Check: the repo URL opens and the CI run goes green.
5. **Without a GitHub sign-in.** `--no-github` stops after the commit and prints the three GitHub steps. Later, where `gh` is signed in, `pnpm -C <baseline> app-create --github-only` inside the render does them and runs CI; it reads the name and description from the render, uses the render's `origin` when it has one instead of creating a repo, and skips a `ci` ruleset that already exists.
   - **In a cloud agent session**, which can push only to repos it was given: the agent renders with `--no-github` and checks it with `pnpm run ci`. The owner creates an empty private repo `<owner>/<name>` and gives the session access to it; the agent adds it as `origin` and pushes `main`. On their own machine the owner clones it and runs `pnpm -C <baseline> app-create --github-only` inside the clone for the ruleset, the Dependabot settings and the first CI run.
6. **Run the Project.** `cd <name>`, then `pnpm dev`, which starts Postgres 18 and Redis 8 with Docker first. Sign-in uses the memory issuer in development. Check: the printed URL loads and sign-in works.
7. **First pull request: the first Domain.** On a branch, add the Domain's term to `CONTEXT.md` under `## Language`, then `pnpm domain-create <name> --bare` with the parts it needs ([walkthrough](../../apps/app/docs/agents/domain-create.md)). Shape its Model, then `pnpm codegen --name <name>_create` for its first migration. Run `pnpm run ci`, open a PR and show the person the `ci / <job>` checks. Main merges by squash once every required check passes. Nothing is released before this PR, so its migration and API are new, not changes.
8. **What comes next.** The Project owns its code now. Newer Template releases arrive by `pnpm template-upgrade` ([walkthrough](../../apps/app/docs/agents/template-upgrade.md)), and dependency updates by Dependabot ([walkthrough](../../apps/app/docs/agents/dependency-updates.md)).
