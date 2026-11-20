# Publishing the SDK and the command line tool

For a Project that has the `sdk` piece (and maybe `cli`; [pieces.md](pieces.md)). On every push to main, `.github/workflows/clients-release.yml` runs `scripts/clients-release.ts`, which publishes `clients/sdk` as `@<scope>/<project>-sdk` and `clients/cli` as `@<scope>/<project>-cli` when they changed. They go to GitHub Packages, the npm registry of the Project's own repository (`https://npm.pkg.github.com`), never to public npm: the SDK carries every Environment's URL from `clients/environments.json`, so whoever can install it can read them. The workflow and the script go with the `sdk` piece: `pnpm piece-remove sdk` deletes them. After `pnpm piece-remove cli`, only the SDK publishes. Until the repository variable `CLIENTS_NPM_SCOPE` is set, the workflow's `off` job passes and says why.

## Versions

Never pick a version by hand, and a Project has no changesets.

- Both packages publish at one version, the SDK first. The published command line tool depends on exactly that SDK version, and the SDK on `@n8io/baseline-sdk` from public npm.
- The major is the API's: `info.version` in `clients/sdk/openapi.json` (`/api/v1` is 1.x). oasdiff already blocks a breaking change inside a major ([api.md](api.md)).
- The script compares the files with the newest version published in that major. A change to what the SDK can call (`openapi.json`, `sdk.ts`, `clients/environments.json`) publishes the next minor. Any other change (`sdk-fetch.ts`, `index.ts`, `cli.ts`, a dependency) publishes the next patch. No change publishes nothing, and with nothing published yet the version is `<major>.0.0`.
- An Environment's new URL is a new release: a caller gets it by upgrading the SDK, or passes `baseUrl` (`--url`) until then.
- The registry gets JavaScript built into `dist/` with type declarations, `environments.json`, the TypeScript sources beside them, and the repository named, which links the package to it.
- To see what would publish without publishing: `CLIENTS_NPM_SCOPE=<scope> node scripts/clients-release.ts --dry-run`.

## Turning it on

Set the repository variable `CLIENTS_NPM_SCOPE` to the repository's owner, the only scope GitHub Packages takes for it (Settings, Secrets and variables, Actions, Variables). The workflow publishes with its own `GITHUB_TOKEN` (`packages: write`), so there is no token to store, no first publish by hand and no trusted publisher. Run the workflow by hand from the Actions tab to check it. A package published from a private repository is private, readable by whoever can read the repository.

## Installing them

Another repository, or a person, installs them like this:

1. A token that can read packages: a classic personal access token with `read:packages` (GitHub Packages' npm registry takes no fine-grained token), or the `GITHUB_TOKEN` of a workflow in a repository the package grants access to.
2. An `.npmrc` beside the consumer's `package.json`: `@<scope>:registry=https://npm.pkg.github.com` and `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}`, with the token in `NODE_AUTH_TOKEN`. The line sends every `@<scope>/` package to GitHub Packages, including the SDK's own dependency when the scope is also on public npm (`@n8io/baseline-sdk`): GitHub says it serves npmjs.org packages through its registry, but check that install before relying on it.
3. Another repository's CI: in the package's settings on GitHub (Manage Actions access), add that repository with read access; its workflow then installs with `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` and `packages: read`.
4. Dependabot in that repository: a `registries` entry of `type: npm-registry`, `url: https://npm.pkg.github.com`, `token: ${{ secrets.<NAME> }}` (a Dependabot secret holding a `read:packages` token), listed under the npm `updates` entry's `registries`.

## When a publish fails

- `E401`, `E403` or `ENEEDAUTH`: `CLIENTS_NPM_SCOPE` is not the repository's owner, the workflow lost `packages: write`, or a package of that name already belongs to another repository (give this one write access in the package's settings, or delete it).
- The SDK published and the command line tool did not: the next run publishes both at the next patch.
- Check a release on the repository's Packages page; `npm view @<scope>/<project>-sdk versions --registry https://npm.pkg.github.com` needs the token too.
