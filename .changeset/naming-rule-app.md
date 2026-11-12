---
"app": major
---

The Template follows the full naming rule, and architecture rule A23 now checks all of it: an exported function in a Domain starts with the Domain's name, a factory ends in `Create`, and a predicate ends in `Is`, `Has` or `Can`. `ci.yml` calls `app-ci.yml@v3` and `dependabot-automerge.yml@v3`.

When you upgrade, rename in each of your Domains what `pnpm domain-create` generated from `foo`:

- `<domain>Routes`, `<domain>LiveRoutes`, `<domain>Schedule` → add `Create`.
- `<domain>RepositoryPostgres`, `<domain>RepositoryMemory`, `<domain>CacheRedis`, `<domain>CacheMemory`, `<domain>TransactionPostgres`, `<domain>TransactionMemory`, `<domain>PortsMemory` → add `Create`.
- Rules: `<domain>Deletable` → `<domain>DeleteCan` in `rules/<domain>-delete-can.ts`, `<domain>Updatable` → `<domain>UpdateCan` in `rules/<domain>-update-can.ts`, `<domain>Stale` → `<domain>StaleIs` in `rules/<domain>-stale-is.ts`.
- `use-cases/<domain>-use-cases-create.ts` → `use-cases/<domain>-use-cases.ts`.
- `authnProviderOptions` in `src/authn.ts` → `authnProviderOptionsCreate`.

Then rename the package imports listed in the package changelogs, and run `pnpm check`: A23 names anything you missed.
