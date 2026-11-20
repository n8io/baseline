# Keep varlock for env vars and secrets

Status: accepted, 2026-11-13

The Template reads its env vars and secrets through varlock (`.env.schema`, the generated `src/env.d.ts`, `src/env.ts`), and there is no config Package. We compared moving to t3-env, and to a Package of our own, and stayed on varlock because it has a plugin per secret store (Infisical, 1Password, AWS Secrets Manager, Bitwarden), so changing stores is one config change in one place; on t3-env it is a deployment change in every Project. Reopen only for a new reason, such as varlock no longer being maintained or a second app needing to share one schema.
