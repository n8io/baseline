---
"app": minor
---

A new Project starts with no Domain, and its first pull request adds the first one (`pnpm app-create`, from baseline's root).

- The Template's `.github/workflows/ci.yml` also runs on `workflow_dispatch`; app-create uses it to run CI once on a new Project's main.
- `app-ci.yml`'s `migrations` job passes a Project that has no table yet (drizzle-kit generate refuses an empty schema).
- `CONTEXT.md`'s Foo entry no longer says app-create replaces Foo.
- baseline's `app-create` drops `--domain`, `--plural` and `--definition`, warns when main holds changesets the newest release does not, waits for npm to serve the release's `@n8io/baseline-*` versions before it installs, and gains `--no-github` (render and commit only) and `--github-only` (the repo, ruleset, Dependabot settings and first CI run, inside an existing render). docs/agents/project-create.md walks through both, and the path for a cloud agent session.

To upgrade a Project: the Template upgrade brings the `workflow_dispatch` trigger; nothing to apply by hand.
