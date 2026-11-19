---
"app": minor
---

A new removable `cli` piece: the Project's command line tool in `clients/cli`, its own package (`<project>-cli`) whose command is the Project's name. It hands the SDK's OpenAPI document and functions to `cliCreate` from `@n8io/baseline-cli`, so every operation is a command (`invoiceLineCreate` is `<project> invoice-line create --name x`) with no command code of the Project's own; `login --client-id <id>` stores a token, and `--url` or `<PROJECT>_URL` names the API. The SDK package also exports its `openapi.json`. `pnpm piece-remove cli` takes it out (`docs/agents/pieces.md`, "The CLI"), and `pnpm piece-remove sdk` now refuses until it is gone.

To upgrade a Project: after `pnpm template-upgrade`, run `pnpm install` and commit `clients/cli` with the lockfile. If the Project will never ship a CLI, run `pnpm piece-remove cli` instead.
