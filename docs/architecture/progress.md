# Architecture entropy progress

Living tracker for the "reduce architectural entropy" initiative. Each round: scan, find entropy, check real callers, pick the lowest-complexity option, add a baseline test, migrate every caller, delete the replaced code, review, verify, add an anti-regression check, record here.

Decisions made along the way go in [docs/adr](../adr/README.md). Items needing product decisions or a breaking migration go in the pending list below, not in a PR.

## Round 0: survey (2026-11-28)

Inventory from the `claude/project-thread-pc34lm` branch at 49d7f42:

- 19 Packages in `packages/`: analytics, authn, cache, cli, error-tracking, feature-flags, health, http, id, live, logger, postgres, queue, redis, result, sdk, shared, shutdown, telemetry.
- The Template is `apps/app` (contexts `foo`, `apps/app/src/ui`, `apps/app/scripts` with 93 files, `apps/app/clients/{cli,sdk}`).
- Governance: 12 ADRs in `docs/adr/`, root `AGENTS.md` and `CONTEXT.md` plus `CONTEXT-MAP.md`, per-area guides in `docs/agents/`.
- Architecture rules are enforced by `apps/app/architecture-test-rules.ts` (A-numbered rules) and Biome GritQL plugins in `apps/app/lint-plugins/`.

Open items already decided by Nate, not to re-open:

- Package renames and splits (authn, feature-flags, #654) deferred to the next major.
- Version packages PR #698 on hold until Nate asks.
- Epic #652 hill-climb belongs to the "Rate the codebase" thread; coordinate, do not collide.

## Optimization task pool

Ordered by value over risk. Nothing here has been started except where marked.

| # | Task | Status |
|---|------|--------|
| 1 | Map the real callers of `apps/app/scripts/` (93 files) and find duplicate helpers | next |
| 2 | Find `packages/shared` helpers used by one package only (move to owner or delete) | queued |
| 3 | Look for shallow forwarding modules in `packages/*/src` (files that only re-export) | queued |
| 4 | Check the dependency direction Packages to Template and Template to Packages with a lint rule | queued |
| 5 | Config and env: confirm one reader per variable (varlock, `process.env` ban in lint) | queued |

## Pending confirmation (needs Nate)

- Package splits or renames (authn, feature-flags) are breaking, held for the next major.

## Log

- 2026-11-28: survey recorded; task pool created; first scan is task 1.
