---
"app": minor
---

`pnpm domain-create` makes the Domain you ask for, and its output reads as success.

- `--bare` copies only the core (Model, ports, errors, create/get/list/update/delete, the API, repository with its contract test, transaction, created and deleted Events). `--analytics`, `--cache`, `--live`, `--pages`, `--schedule` and `--seed` add one part each, wiring included. Without `--bare` it copies everything, as before.
- `--reads <domain>` (repeatable) writes the reader port, `readers` as the required second argument of `<name>PortsCreate`, its memory fake, the Bridge in `src/bridges/` with its test, and the wiring in `src/use-cases.ts`. It refuses a Domain that does not exist or already reads the new one.
- `--help` / `-h` print what each flag writes; an unknown flag prints the usage and exits 1, with no stack trace. Every script in `scripts/` stops with "needs Node 26, found <version>" on an older Node.
- Scripts keep a working command's stderr out of the terminal (no detached-HEAD advice, no "error: could not apply" from a Template fetch); a failing command's error still carries it. domain-create runs `pnpm check` and `pnpm test` quietly and ends with the next steps for the flags used, naming `pnpm codegen --name <name>_create` until the Domain has a migration.
- New page `docs/agents/domain-create.md`: add the `CONTEXT.md` entry first, what each flag writes, and what it never writes (business Rules, Consumers, outcome Events). `bridges.md` now says `--reads` writes the Bridge.

To upgrade a Project: take `scripts/` from the Template (the Template upgrade does). Domains a Project already has are unchanged; the Foo changes in this release are domain-create markers only, so there is nothing to apply by hand.
