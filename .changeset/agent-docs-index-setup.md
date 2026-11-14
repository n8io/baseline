---
"app": minor
---

AGENTS.md indexes every agent doc and names every command, and a cloud agent session has a written setup.

- `scripts/agent-setup.sh` and `docs/agents/agent-setup.md` (new): ready a fresh cloud container in one command: Node from `.node-version` through nvm, the pinned pnpm, `pnpm install --frozen-lockfile`, a running `dockerd` that pulls through `mirror.gcr.io`, and the `oasdiff` status. The page also covers a daemon that dies between turns, `IMAGE_REGISTRY`, and building the image behind a TLS proxy without committing its CA.
- `docs/agents/planning.md` (new): ask once for a build of several Domains with an approved plan, what `domain-create` already writes, ticket size, and how parallel Domain PRs share the wiring files and migrations.
- `docs/agents/api.md`: route conventions (command routes `POST /<things>/{id}/<verb>`, 422 for a missing referenced id, 200 for an upsert).
- AGENTS.md: the dev URL (5173, not `PORT`), one integration file with `pnpm test:integration <path>`, `pnpm dev:reset`, `pnpm api-check`, `pnpm piece-check`, no coverage tooling, Domain tests free of module state, the two Biome naming traps in tests, where a helper two Use cases share goes, the clock rule (A26), test helpers exempt from `useMaxParams`, and Read when lines for the two new pages and `piecesKept`. It stays under 13,000 bytes.
- A structure test fails when AGENTS.md or a `docs/agents/` page names a `pnpm` command that is no script and no pnpm command (a binary runs through `pnpm exec`), and a test checks that the render keeps AGENTS.md and every agent doc whole. `tracing.md`, `data.md`, `template-upgrade.md` and AGENTS.md no longer name the example Domain, so a Project's copy keeps every line.

To upgrade a Project: the Template upgrade brings these files. `structure.test.ts` now fails on a `pnpm` command your own AGENTS.md lines or `docs/agents/` pages name that is no script and no pnpm command: fix the doc, and run a binary as `pnpm exec <bin>`. Keep your own AGENTS.md lines within the 14,000-byte budget.
