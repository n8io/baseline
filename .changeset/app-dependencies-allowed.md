---
"app": major
---

Every runtime dependency now needs an entry in `dependencies-allowed.json`, a one-line reason per package name, and `dependencies-allowed.test.ts` fails on a dependency without one and on an entry no runtime dependency uses. `@n8io/baseline-*` packages are exempt, and a version update changes no entry. `pnpm piece-remove` drops a removed piece's entries.

Upgrade: after `pnpm template-upgrade`, run `pnpm test dependencies-allowed`. For each dependency it names that your Project added, add `"<name>": "<reason>"` to `dependencies-allowed.json`; remove each entry it names that your Project no longer uses. See `docs/agents/dependency-updates.md` ("Adding a dependency").
