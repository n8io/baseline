# Changing the Template

Read when changing anything under `apps/app` in baseline. `apps/app/AGENTS.md` holds the rules a Project keeps; this page holds the ones that exist because `apps/app` is also rendered into every new Project and merged into every old one by `pnpm template-upgrade`.

## What the render does

`app-create` renders `apps/app` with `apps/app/scripts/template-render.ts`. The `foo` context never renders, and in every file except `CONTEXT.md` and `README.md` a line that names `foo`, `Foo` or `FOO` is dropped, along with the statement around it in code.

- **Docs.** Write examples in an agent doc with an `invoice` context, or the line disappears from the Project's copy. The pages `test/agent-docs-quotes.test.ts` checks against the Template's code (it lists them) quote foo's files as `baz`, because `bar` is the Template's real second Aggregate.
- **Markers.** Never start a doc line or a changeset line with a `piece-start:`, `wiring:` or `aggregate-create-start:` marker: `piece-remove` cuts from it and `aggregate-create` treats the file as wiring. Name a marker inside a sentence. `test/changelog-markers.test.ts` guards the changesets.
- **README.** `apps/app/README.md` keeps a `# app` title, one bold description line and a `<sub>` line about the Template; the render throws without them.

## Budgets

Each one is a test; raise a limit only on purpose, in the same pull request, and say why.

- The Template's `AGENTS.md` stays at or under 13,000 bytes, so a Project has 1,000 bytes for its own rules under its 14,000. Only the root tests check it (`test/agent-docs.test.ts`), not `apps/app`'s: run `pnpm exec vitest run test/agent-docs.test.ts` at the root after editing it.
- `piece-start:` blocks have a total and a per-file limit (`test/piece-markers.test.ts`), and `aggregate-create-start:` blocks a total (`test/aggregate-create-markers.test.ts`). A piece prefers whole files.

## Checks a Template change must pass

`pnpm exec turbo run check test build` is only CI's `packages` job. A Template change fails in the others, so also run:

- `pnpm -C apps/app run ci`: check, unit tests, integration tests (needs `pnpm dev` running in `apps/app`) and `piece-check`, the `integration` job and most of what a Project's CI runs.
- `node test/render/render-and-test.ts <empty folder>`: the `render` job. It renders `origin/main` as `app-create` does, upgrades it to this checkout's `HEAD` with `template-upgrade`, adds contexts with every part and applies the second-domain fixture. It reads `HEAD`, so commit first (a work-in-progress commit is fine). About a minute, no Docker. `pnpm run ci` inside that folder then runs most of what `render-and-test` runs.
- `node test/render/api-only.ts <empty folder>`: the `api-only` job, which removes each piece alone and all together, then reverts.

## The render fixture

`test/render/second-domain/` (`files/` and `wiring.patch`) adds an Event handler between two rendered contexts. The patch holds a copy of the generated `src/env.d.ts` and hunks against files rendered from foo, so a new `.env.schema` line, or a foo change next to a hunk, breaks the `render` job. To regenerate it:

1. Commit, then `RENDER_AND_TEST_STOP=fixture node test/render/render-and-test.ts <folder>`.
2. In that folder copy `test/render/second-domain/files` in and `git apply` the old patch (`--exclude` the hunks you will redo, or `--reject` and apply the rejects by hand).
3. Make the change, then `pnpm exec biome check --write .` and `pnpm exec varlock codegen`.
4. Copy new untracked `src` files to `files/`, and save `git diff` as `wiring.patch`. A route change also needs the `sdk-generate` script.

## Changesets

A Template change that should ship needs an `app` changeset, beside one for each Package it touches. It is major when a Project must adapt to it: a renamed or moved file a Project edits, a new architecture rule or check that can fail a Project that passed before, or an added, renamed or removed `app-ci.yml` job. The [release walkthrough](release.md) has the rest.

## Semgrep rules

`ci / sast` scans with a pinned snapshot of Semgrep's `p/typescript`, `p/nodejs`, `p/react` and `p/secrets` packs: `.github/semgrep/rules.txt` names one commit of github.com/semgrep/semgrep-rules and the rule files, so a new upstream rule cannot fail a pull request on its own, and Dependabot does not move it. A maintainer moves it by hand, in a baseline pull request; Projects get it with their next `app-ci.yml` release.

1. `node scripts/semgrep-rules-write.ts <semgrep-rules commit>` rewrites `rules.txt` from today's packs at that commit.
2. Run `sh .github/semgrep/rules.sh .github/semgrep/rules.txt <folder>` and `semgrep scan --no-rewrite-rule-ids --config <folder>` on baseline's `packages scripts test`, a rendered Template and each known Project, before and after.
3. Commit the new `rules.txt` with a changeset. A bump that adds a finding is a new failing check: it ships with its fixes in the same release, or waits for the next major.
