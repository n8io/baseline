---
"app": patch
---

`pnpm template-upgrade` waits for npm to serve every `@n8io/baseline-*` tarball before it installs, so an upgrade to a release published minutes ago no longer fails with `ERR_PNPM_TARBALL_HTTP_STATUS` 404. A wait that runs out names the missing tarball, says it is a registry delay, and says what to run by hand. The upgrade that brings this release in still runs your old `template-upgrade.ts`, so the wait applies from the next upgrade.

To upgrade a Project: run `pnpm template-upgrade`; it takes `scripts/npm-tarballs-wait.ts`, `scripts/template-upgrade.ts` and their tests, and `docs/agents/template-upgrade.md`.
