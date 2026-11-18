# Walkthrough: Template upgrade

Read when running `pnpm template-upgrade`, resolving its conflicts, or when someone asks to be walked through one. To start one, ask your agent: "Walk me through a template upgrade with docs/agents/template-upgrade.md."

## How to guide

- Take one step at a time. Say what the step does and why, show the command, and run it only after the person says go.
- After each step, show what changed and how to tell it worked. Stop at the first failure and explain it before you try anything else.
- Never pick a side of a conflict silently: show both sides, say which you would keep and why, and let the person decide.
- End by summarising what the upgrade changed and what still needs the person.

## Steps

1. **Start clean.** `git status` shows nothing to commit, then `git switch -c template-upgrade`. Read `.template.json`: its `release` is the Template release this Project came from.
2. **Pick the target.** `pnpm template-upgrade` goes to the newest release; `--to <version>` picks one. For a jump across a major, read the Template changelog first, do any step it says comes before the upgrade (a major that changes the required checks moves the ruleset first), and go one major at a time.
3. **Run it.** If `.template.json` already names the target release it says so and stops. Otherwise it renders the current release and the target with the answers in `.template.json`, each with its own render code, and applies the difference to your tree without committing: a 3-way merge that keeps your changes and brings in the Template's. It prints the Template changelog between the two and moves `.template.json` to the target.
4. **Apply Template-Domain changes by hand.** The changelog lists changes to the Template's own Domain, the one `pnpm domain-create` copies, under its Template name. Your Domains were copied from it, so the upgrade does not change them; walk through each such entry with the person and apply it to every Domain that needs it.
5. **Resolve conflicts.** On a conflict it exits 1 and lists the files. Resolve every `<<<<<<<` marker (for `src/env.d.ts`, which is generated, take either side: `pnpm check` regenerates it; `README.md` is the Project's, so keep yours and take only the new `app@` release in its `<sub>Made from` line), then `pnpm install`, `pnpm check` and `pnpm test`. It formats `.template.json` either way; without conflicts it runs install, format, check and test itself. If the install answers 404 for a new `@n8io/baseline-*` tarball, npm is still publishing: wait and retry; the same wait stops the run with that message. Check: `git grep -n '^<<<<<<<'` finds nothing.
6. **Run what CI runs.** `pnpm dev` starts this Project's services, or `varlock run -- docker compose -p <project> up -d` does (bare `docker compose` publishes the default ports, not this Project's); then `pnpm run ci` (check, unit, integration, piece-check; piece-check reads the commit, so commit the upgrade first) and `pnpm api-check`. A failing migrations step in CI's `check` usually means a table changed without `pnpm codegen`.
7. **Pull request.** Commit, open a PR and let `app-ci.yml` run every required check; `check` includes oasdiff (no breaking `/api/v1` change) and the migrations steps (migrations already merged never change). Merge by squash once green.

A Project's own piece paths go in `pieceFiles` in `.template.json` (docs/agents/pieces.md), never in `scripts/piece-remove.ts`: an upgrade that changes the script conflicts with them.
