---
"app": major
---

The Template's secret store is now Infisical (`@varlock/infisical-plugin`) instead of 1Password. `.env.production` holds bare `NAME=infisical()` references, each read from the secret of the same name in the Infisical project's `prod` environment, so the file is the same in every Project and `app-create` no longer rewrites it. A Project that boots with every variable already set in its environment changes nothing at run time.

To upgrade a Project:

1. **Before the upgrade**, make your `scripts/template-render.ts` tolerate the plugin swap, and commit it. Your own `template-upgrade` renders this release with your installed tools, which lack the Infisical plugin. In `templateFinish`, wrap the `varlock codegen` `run({...})` call in `try { ... } catch (error) { if (!/Plugin "[^"]+" unable to resolve/.test((error as Error).message)) throw error; }`. The upgrade then brings in the Template's version of that block.
2. Run `pnpm template-upgrade`. It swaps the dependency, the two `.env.schema` header lines and the `OP_SERVICE_ACCOUNT_TOKEN` item for the four optional `INFISICAL_*` items.
3. `.env.production` conflicts, because `app-create` wrote your vault name into it: take the Template's side, then add back any line of your own as `NAME=infisical()`, or `NAME=infisical("SECRET_NAME")` where the secret in Infisical has another name. Do the same in any `.env.development.local`. If `src/env.d.ts` conflicts, take either side; `pnpm check` regenerates it. Then run `pnpm install`, `pnpm check` and `pnpm test`.
4. In Infisical, create a project with a secret for each reference in its `prod` environment, and a machine identity with Universal Auth and read access to that project.
5. Where the app boots and fetches secrets, set `INFISICAL_PROJECT_ID`, `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET`, plus `INFISICAL_SITE_URL` for a self-hosted Infisical, allow outbound HTTPS to it, and remove `OP_SERVICE_ACCOUNT_TOKEN`. Where every variable is already set in the environment, set none of them.
