# Walkthrough: create a Project

Read when someone asks to create a new Project, or asks to be walked through it. To start one, ask your agent: "Walk me through creating a Project with docs/agents/project-create.md."

## How to guide

- Take one step at a time. Say what the step does and why, show the command, and run it only after the person says go.
- After each step, show what changed and how to tell it worked. Stop at the first failure and explain it before you try anything else.
- Ask before anything that cannot be undone: creating the GitHub repo is the only such step here.
- End by summarising what now exists and what the person does next.

## Steps

1. **Check the tools.** Node 26 (`fnm use` reads `.node-version`), pnpm from `packageManager`, Docker running, and `gh auth status` logged in. Then `pnpm install` in baseline. Check: `node --version` prints v26.
2. **Choose the answers.** `app-create` asks for five: the Project's name (kebab case, also the repo name), a one-line description, and the first Domain's name, plural and definition. Help the person pick a Domain that is one business entity (`invoice`, not `billing`). The definition becomes the Domain's entry in the Project's `CONTEXT.md`, so write it as a glossary sentence.
3. **Run it.** `node scripts/app-create.ts`, or pass the answers as `--name --description --domain --plural --definition [--owner]`. It renders the newest `app@` release into `./<name>` with that release's own render code, writes `.template.json` (the release it came from, which `pnpm template-upgrade` starts from), a fresh `AUTHN_SECRET` in `.env.development` and the `op://<name>-production` vault in `.env.production`, creates the first Domain and its migration, and commits.
4. **Repo and ruleset.** The same run creates the private GitHub repo, pushes, adds a ruleset on the default branch that requires every `app-ci.yml` job (`ci / check`, `unit`, `integration`, `migrations`, `oasdiff`, `image`, `sast`), and turns on Dependabot alerts and security updates. This is the step to confirm first. If it stops earlier, `./<name>` holds the partial render and nothing exists on GitHub yet. Check: the URL it prints opens.
5. **Run the Project.** `cd <name>`, `docker compose up -d` (Postgres 18 and Redis 8), then `pnpm dev`. Sign-in uses the memory issuer in development. Check: the printed URL loads and sign-in works.
6. **First pull request.** Make a small change on a branch, run `pnpm run ci`, open a PR and show the person the `ci / <job>` checks. Main merges by squash once every required check passes.
7. **What comes next.** The Project owns its code now. Newer Template releases arrive by `pnpm template-upgrade` ([walkthrough](../../apps/app/docs/agents/template-upgrade.md)), and dependency updates by Dependabot ([walkthrough](../../apps/app/docs/agents/dependency-updates.md)).
