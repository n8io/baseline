# Walkthrough: Template upgrade

Read when running `pnpm template-upgrade`, resolving its conflicts, or when someone asks to be walked through one. To start one, ask your agent: "Walk me through a template upgrade with docs/agents/template-upgrade.md."

## How to guide

- Take one step at a time. Say what the step does and why, show the command, and run it only after the person says go.
- After each step, show what changed and how to tell it worked. Stop at the first failure and explain it before you try anything else.
- Never pick a side of a conflict silently: show both sides, say which you would keep and why, and let the person decide.
- End by summarising what the upgrade changed and what still needs the person.

## Steps

1. **Start clean.** `git status` shows nothing to commit, then `git switch -c template-upgrade`. Read `.template.json`: its `release` is the Template release this Project came from.
2. **Pick the target.** `pnpm template-upgrade` goes to the newest release; `--to <version>` picks one. For a jump across a major, read the Template changelog first and go one major at a time.
3. **Run it.** If `.template.json` already names the target release it says so and stops. Otherwise it renders the current release and the target with the answers in `.template.json`, each with its own render code, and applies the difference to your tree without committing: a 3-way merge that keeps your changes and brings in the Template's. It prints the Template changelog between the two and moves `.template.json` to the target.
4. **Apply Foo changes by hand.** The changelog lists changes to the Foo Domain. Your Domains were copied from Foo, so the upgrade does not change them; walk through each Foo entry with the person and apply it to every Domain that needs it.
5. **Resolve conflicts.** On a conflict it exits 1 and lists the files. Resolve every `<<<<<<<` marker (for `src/env.d.ts`, which is generated, keep yours and run `pnpm check`), then `pnpm install`, `pnpm check` and `pnpm test`. Without conflicts it runs install, format, check and test itself. Check: `git grep -n '^<<<<<<<'` finds nothing.
6. **Run what CI runs.** `pnpm dev` starts this Project's services, or `varlock run -- docker compose -p <project> up -d` does (bare `docker compose` publishes the default ports, not this Project's); then `pnpm run ci`. A failing `migrations` check usually means a table changed without `pnpm codegen`.
7. **Pull request.** Commit, open a PR and let `app-ci.yml` run every required check, including `oasdiff` (no breaking `/api/v1` change) and `migrations` (migrations already merged never change). Merge by squash once green.
