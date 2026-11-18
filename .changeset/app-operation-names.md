---
"app": minor
---

Every API operation now sets `operationId` to the name of the Use case its handler calls (`fooCreate`) and one tag, its Domain in camelCase (`foo`), so a generated SDK or CLI gets readable names. `domain-create` writes both for a new Domain, `info.title` is the Project's package.json `name`, and `server-wiring.test.ts` fails on a missing or duplicate operationId, a tag count other than one, or a tag that is not a Domain. `pnpm api-check` now fails when an operationId or a tag is renamed or removed.

Upgrade: after `pnpm template-upgrade`, add `operationId: "<useCase>"` and `tags: ["<domain>"]` to each `createRoute` in your Domains' `api/*-routes.ts`, then run `pnpm test:integration server-wiring`. Adding them is not breaking; renaming them later is.
