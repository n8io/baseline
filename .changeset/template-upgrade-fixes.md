---
"app": patch
---

`pnpm template-upgrade` stops silently dropping what a Project still uses, and applies each release's own export. After the merge it checks every package the Template removed from `package.json` against the Project's `src/`, `test/`, `scripts/` and `clients/`; when code still imports one it names the package and the files, says to `pnpm add` it and restore its `dependencies-allowed.json` line, and stops before the install would prune it. It also exports each release with that release's own `templateExport` (as it already rendered with the release's own render code), so a release's change to the workspace block or the client pins reaches the Project; this applies from the upgrade after the one that brings this release, since that upgrade still runs the Project's old scripts. `glossary-check` lets a context use the terms of a context it has an ACL to and any term its own `CONTEXT.md` uses. The agent docs and `compose.yaml` write `pnpm exec varlock run -- docker compose`, because varlock is a devDependency, not a global command; a test fails a bare `varlock` command in an agent doc.

To upgrade a Project: nothing to do.
