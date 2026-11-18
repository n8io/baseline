---
"app": major
---

The Template's secret store is now Infisical (`@varlock/infisical-plugin`) instead of 1Password. `.env.production` holds bare `NAME=infisical()` references, each read from the secret of the same name in the Infisical project's `prod` environment, so the file is the same in every Project and `app-create` no longer rewrites it. A Project that boots with every variable already set in its environment changes nothing at run time.

To upgrade a Project:

1. In `package.json`, replace `"@varlock/1password-plugin"` with `"@varlock/infisical-plugin": "^2.1.3"` and run `pnpm install`.
2. In `.env.schema`, replace the `# @plugin(@varlock/1password-plugin)` and `# @initOp(...)` header lines with `# @plugin(@varlock/infisical-plugin)` and `# @initInfisical(projectId=$INFISICAL_PROJECT_ID, environment=prod, siteUrl=$INFISICAL_SITE_URL, clientId=$INFISICAL_CLIENT_ID, clientSecret=$INFISICAL_CLIENT_SECRET)`.
3. In `.env.schema`, replace the `OP_SERVICE_ACCOUNT_TOKEN` item with the four optional items `INFISICAL_PROJECT_ID`, `INFISICAL_SITE_URL`, `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET`, copied from the Template's `.env.schema`, then run `pnpm exec varlock codegen`.
4. In `.env.production` (and any `.env.development.local`), turn each `NAME=op(op://...)` into `NAME=infisical()`, or `NAME=infisical("SECRET_NAME")` where the secret in Infisical has another name.
5. In Infisical, create a project with a secret for each reference in its `prod` environment, and a machine identity with Universal Auth and read access to that project.
6. Where the app boots and fetches secrets, set `INFISICAL_PROJECT_ID`, `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET`, plus `INFISICAL_SITE_URL` for a self-hosted Infisical, allow outbound HTTPS to it, and remove `OP_SERVICE_ACCOUNT_TOKEN`. Where every variable is already set in the environment, set none of them.
