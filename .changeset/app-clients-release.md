---
"app": minor
---

The `sdk` piece now publishes the SDK and the command line tool to npm. `.github/workflows/clients-release.yml` runs `scripts/clients-release.ts` on every push to main, which publishes `clients/sdk` as `@<scope>/<project>-sdk` and `clients/cli` as `@<scope>/<project>-cli` at one version, built to JavaScript with type declarations. The major is the API's (`/api/v1` gives 1.x); a change to the generated SDK publishes the next minor, any other change to either package the next patch, and no change nothing. It uses npm trusted publishing (no stored token) and adds provenance when the repository is public. It does nothing, and passes, until the repository variable `CLIENTS_NPM_SCOPE` is set. `docs/agents/clients.md` lists the one-time steps; `pnpm piece-remove sdk` removes the workflow and script with the SDK.

To upgrade a Project: after `pnpm template-upgrade`, commit the new workflow and script. To publish, follow "Turning it on" in `docs/agents/clients.md`; otherwise leave `CLIENTS_NPM_SCOPE` unset.
