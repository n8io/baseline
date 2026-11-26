# Changing the Template

Read when changing anything under `apps/app` in baseline. `apps/app/AGENTS.md` holds the rules a Project keeps; this page holds the ones that exist because `apps/app` is also rendered into every new Project and merged into every old one by `pnpm template-upgrade`.

## What the render does

`app-create` renders `apps/app` with `apps/app/scripts/template-render.ts`. The `foo` context never renders and `CHANGELOG.md` is not copied. `scripts/` and `pnpm-lock.yaml` are copied as they are. In every other file except `CONTEXT.md` and `README.md`, a line that names `foo`, `Foo` or `FOO` is dropped, along with the statement around it in code.

- **Docs.** Write examples in an agent doc with an `invoice` context, or the line disappears from the Project's copy. The pages `test/agent-docs-quotes.test.ts` checks against the Template's code (it lists them) quote foo's files as `baz`, because `bar` is the Template's real second Model.
- **Markers.** Never start a doc line or a changeset line with a marker comment (`piece-start:`, `piece-end:`, `wiring:`, `model-create-start:`, `model-create-end:`, after `//` or `#`): `piece-remove` cuts from it and `model-create` treats the file as wiring. Name a marker inside a sentence. `test/changelog-markers.test.ts` guards the changesets.
- **README.** `apps/app/README.md` keeps a `# app` title, one bold description line and a `<sub>` line about the Template; the render throws without them.

## Budgets

Each one is a test; raise a limit only on purpose, in the same pull request, and say why.

- The Template's `AGENTS.md` stays at or under 13,000 bytes, so a Project has 1,000 bytes for its own rules under its 14,000. Only the root tests check it (`test/agent-docs.test.ts`), not `apps/app`'s: run `pnpm exec vitest run test/agent-docs.test.ts` at the root after editing it.
- `piece-start:` blocks have a total and a per-file limit (`test/piece-markers.test.ts`), and `model-create-start:` blocks a total (`test/model-create-markers.test.ts`). A piece prefers whole files.

## Checks a Template change must pass

`pnpm exec turbo run check test build` is only CI's `packages` job. A Template change fails in the others, so also run:

- `pnpm -C apps/app run ci`: check, unit tests, integration tests and `piece-check`, most of what a Project's CI runs. It needs `pnpm dev` running in `apps/app`, and `piece-check` reads `HEAD`, so commit first. The `integration` job also fails when `clients/sdk` is stale: after a route change, run the `sdk-generate` script in `apps/app` and commit `clients/sdk/`.
- `node test/render/render-and-test.ts <new folder>` (a path that does not exist yet): the `render` job. It renders the latest `app@` release as `app-create` does (it needs the network), upgrades it to this checkout's `HEAD` with `template-upgrade`, adds contexts with every option and applies the second-context fixture. It reads `HEAD`, so commit first (a work-in-progress commit is fine). About a minute, no Docker. `pnpm run ci` inside that folder then runs most of what the `render-and-test` job runs.
- `node test/render/api-only.ts <new folder>`: the `api-only` job, which removes each piece alone and all together, then reverts.

## The render fixture

`test/render/second-context/` (`files/` and `wiring.patch`) adds an Event handler between two rendered contexts. The patch holds a copy of the generated `src/env.d.ts` and hunks against files rendered from foo, so a new `.env.schema` line, or a foo change next to a hunk, breaks the `render` job. To regenerate it:

1. Commit, then `RENDER_AND_TEST_STOP=fixture node test/render/render-and-test.ts <folder>`.
2. In that folder copy `test/render/second-context/files` in and `git apply` the old patch (`--exclude` the hunks you will redo, or `--reject` and apply the rejects by hand).
3. Make the change, then `pnpm exec biome check --write .` and `pnpm exec varlock codegen`.
4. Copy new untracked `src` files to `files/`, and save `git diff` as `wiring.patch`. A route change also needs the `sdk-generate` script.

## Adding a piece, an option or an architecture rule

Here, unlike in a Project, you edit the shared `apps/app/CONTEXT.md` and the Template's own scripts, still after asking. A change to foo reaches a Project's existing contexts only by hand, so its changeset says what a Project applies to each one.

A new piece (each Package wired into the Template comes as one) is named by hand in:

- `apps/app/scripts/pieces.ts` (`pieceNames` and `pieces`, then `pieceRemovals`: its files, lines and packages; type-checking asks for the rest) and its test, and `piece-check.test.ts`;
- `apps/app/scripts/model-create-options.ts` (`piecesTemplate`) and its test;
- the `piece` matrix in `.github/workflows/app-ci.yml` (`test/app-ci-pieces.test.ts` keeps it equal to `pieceNames`; each entry costs one CI job on every code change that touches a piece);
- `test/render/api-only.ts`;
- the **Piece** entry in `apps/app/CONTEXT.md`, the pieces sentence in `apps/app/README.md`, the root README's pieces table and `scripts/readme-svg/root-pieces.ts`;
- its own section in `apps/app/docs/agents/pieces.md`, and a `(<piece>)` reason in `apps/app/dependencies-allowed.json` for each runtime dependency only it uses.

Its code sits in whole files named for it, or in `piece-start:` blocks within the budget above.

A new option (an `model-create` flag):

- `modelOptions` in `apps/app/scripts/model-create-options.ts`, and its lines in foo inside `model-create-start:` blocks (a piece's own blocks when the option is a piece);
- the options list in `apps/app/docs/agents/context-create.md` and the **Option** entry in `apps/app/CONTEXT.md`;
- a `[option, context name]` pair in `test/render/render-and-test.ts`, which makes one `--bare` context per option.

A new or changed architecture rule:

- its function in `apps/app/architecture-test-rules.ts`, under the next free `A<NN>`;
- a failing sample in `apps/app/architecture-test-samples/a<NN>-<what>.txt` (format at the top of `architecture.test.ts`);
- the rule stated, with its number, in `apps/app/AGENTS.md` or the docs page it belongs to;
- a major `app` changeset, since it can fail a Project that passed before.

## Changesets

A Template change that should ship needs an `app` changeset, beside one for each Package it touches. It is major when a Project must adapt to it: a renamed or moved file a Project edits, a new architecture rule or check that can fail a Project that passed before, or an added, renamed or removed `app-ci.yml` job. The [release walkthrough](release.md) has the rest.

## Changing CI

- `app-ci.yml` is the Template's CI, copied into every Project. A job added, renamed or removed there is a Template major, and `requiredJobs` in `scripts/app-create.ts` lists the jobs a new Project's ruleset requires: keep the two equal.
- `ci.yml`, `release.yml` and `dependabot-automerge.yml` are baseline's own. `test/ci-concurrency.test.ts` holds their triggers, concurrency and token use, and `test/release-workflow.test.ts` the release token.
- `test/ci-pin.test.ts` holds the `app-ci.yml` pins that move with each Template version (`pnpm run version`), and `test/semgrep-pin.test.ts` the Semgrep snapshot below.
- Run `pnpm exec vitest run test/` at the root after any change under `.github/workflows/`.

## Semgrep rules

`ci / sast` scans with a pinned snapshot of Semgrep's `p/typescript`, `p/nodejs`, `p/react` and `p/secrets` packs: `.github/semgrep/rules.txt` names one commit of github.com/semgrep/semgrep-rules and the rule files, so a new upstream rule cannot fail a pull request on its own, and Dependabot does not move it. A maintainer moves it by hand, in a baseline pull request; Projects get it with their next `app-ci.yml` release.

1. `node scripts/semgrep-rules-write.ts <semgrep-rules commit>` rewrites `rules.txt` from today's packs at that commit.
2. Run `sh .github/semgrep/rules.sh .github/semgrep/rules.txt <folder>` and `semgrep scan --no-rewrite-rule-ids --config <folder>` on baseline's `packages scripts test`, a rendered Template and each known Project, before and after.
3. Commit the new `rules.txt` with a changeset. A new pin that adds a finding is a new failing check: it ships with its fixes in the same release, or waits for the next major.

## Maintainer scripts

- `pnpm ci:watch <pull request number>` waits on a pull request's checks and prints a status line each minute. A check that was cancelled (a job over its time limit sends no event) counts as red, and its run is re-run once. Exit code 0 is green, 1 red, 2 gave up after an hour. It reads `GITHUB_TOKEN` or `gh auth token`.
- `pnpm pre-pr` checks the branch against `origin/main` before the pull request opens: size (fails over 1,500 changed lines, lockfiles and changelogs excluded), a changeset when a Package's source changed (a warning), and whether a model review is worth running (skipped for Markdown-only diffs).
- `pnpm kickoff <issue> --title <title> [--context <path>] [--owns <files>]` prints the kickoff for a ticket thread with the standing model rule and gates, so none of it is retyped.
- `pnpm release:verify` checks that `app@<version>` and `v<major>` are on origin and that each Package's version is on npmjs with a provenance attestation, retrying a missing version because the registry lags.
