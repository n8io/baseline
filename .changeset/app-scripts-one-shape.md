---
"app": minor
---

The Template's scripts share one shape. Every command that takes arguments reads them through `scripts/args.ts`: `--help` and `-h` print its usage, an unknown option or a wrong number of arguments prints the usage and exits 1 (`glossary-check`, `piece-check`, `template-upgrade` and `clients-release` used to misread or ignore them). Commands set `process.exitCode` instead of calling `process.exit`. The Pieces live once in `scripts/pieces.ts` (each Piece's name, packages and removal steps), which `aggregate-create`, `context-create`, `piece-check`, `template-upgrade` and the now small `scripts/piece-remove.ts` command read; a new Piece fails type-checking until each says what it does. Shell commands run through `processRun` and `gitRun` in `scripts/process-run.ts`.

To upgrade a Project: if you listed a Project's own files in `scripts/piece-remove.ts`, move them to `pieceFiles` in `.template.json` (docs/agents/pieces.md).
