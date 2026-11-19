# Publishing the SDK and the command line tool

For a Project that has the `sdk` piece (and maybe `cli`; [pieces.md](pieces.md)). On every push to main, `.github/workflows/clients-release.yml` runs `scripts/clients-release.ts`, which publishes `clients/sdk` as `@<scope>/<project>-sdk` and `clients/cli` as `@<scope>/<project>-cli` when they changed. The workflow and the script go with the `sdk` piece: `pnpm piece-remove sdk` deletes them. After `pnpm piece-remove cli`, only the SDK publishes. Until the repository variable `CLIENTS_NPM_SCOPE` is set, the workflow's `off` job passes and says why.

## Versions

Never pick a version by hand, and a Project has no changesets.

- Both packages publish at one version, the SDK first. The published command line tool depends on exactly that SDK version.
- The major is the API's: `info.version` in `clients/sdk/openapi.json` (`/api/v1` is 1.x). oasdiff already blocks a breaking change inside a major ([api.md](api.md)).
- The script compares the files with the newest version published in that major. A change to the generated SDK (`openapi.json`, `sdk.ts`) publishes the next minor. Any other change (`sdk-fetch.ts`, `index.ts`, `cli.ts`, a dependency) publishes the next patch. No change publishes nothing, and with nothing published yet the version is `<major>.0.0`.
- npm gets JavaScript built into `dist/` with type declarations, the TypeScript sources beside it, and the repository named for provenance (added when the repository is public).
- To see what would publish without publishing: `CLIENTS_NPM_SCOPE=<scope> node scripts/clients-release.ts --dry-run`.

## Turning it on

npm trusted publishing (OIDC, no stored token) cannot create a package, so a person does this once per Project:

1. From an up-to-date main, publish both packages by hand: `npm login`, then `CLIENTS_NPM_SCOPE=<scope> GITHUB_REPOSITORY=<owner>/<repo> node scripts/clients-release.ts`. A granular token works only with "Bypass two-factor authentication" ticked; without it npm asks for a browser login.
2. On npmjs.com, for each package, add a trusted publisher: GitHub Actions, this repository, workflow `clients-release.yml`, no environment, and allow direct publishing. A setup made after 2026-09-03 defaults to staged publishing, where each release waits for a 2FA approval. A token that bypasses 2FA cannot add it from the command line (npm answers 403). A setup no workflow uses within 2 days expires.
3. Set the repository variable `CLIENTS_NPM_SCOPE` to the scope (Settings, Secrets and variables, Actions, Variables). Then run the workflow by hand from the Actions tab: with nothing changed it says so and publishes nothing.

## When a publish fails

- `E404` or `ENEEDAUTH`: the package was never published by hand, or its trusted publisher does not name this repository and `clients-release.yml`.
- The SDK published and the command line tool did not: the next run publishes both at the next patch.
- Check a release at `https://registry.npmjs.org/@<scope>/<project>-sdk/<version>`; npm can take a minute to show a new version.
