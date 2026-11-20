# The SDK and the CLI

Read when calling a Project's SDK or CLI, adding an Environment, regenerating them after a route change, publishing them, turning that on, installing them in another repository, or fixing a failed publish. It applies to a Project that has the `sdk` piece (and maybe `cli`); what removing them takes is in [pieces.md](pieces.md).

## Using them

- **The SDK** (`clients/sdk`, published as `<project>-sdk`) has one function per API operation, named by its operationId (`invoiceCreate(body)`), each resolving to `{ status, data, headers }` typed by status.
- **Environments.** A caller picks one once with `sdkConfigure({ environment: "production", token })`, and may pass any option for one call as the function's last argument. `clients/environments.json` lists each Environment's name and API origin; its names are the type, so a misspelt one does not compile. The Template ships `development`, `pnpm dev` at `PORT`. `baseUrl` overrides the Environment only for tests, worktrees (a linked worktree's own instance has its own port) and one-off servers.
- **Timeouts and retries** come from `@n8io/baseline-sdk`, the SDK's one runtime dependency: each call has a 10 s timeout per attempt and 30 s in all (`timeoutMs`, `totalTimeoutMs`). A GET, HEAD or DELETE is sent again up to twice (`retry`) after a network failure, a timeout or a 408, 429, 500, 502, 503 or 504; POST and PATCH are sent once. An Event handler passes `retry: 0`, since the queue already retries it.
- **Regenerating.** The `sdk-generate` script (`scripts/sdk-generate.ts`, the one file that imports the generator, orval) writes `clients/sdk/openapi.json` from the app's document, with each Environment as a `servers` entry whose `description` is its name, and `clients/sdk/sdk.ts` from that; `sdk-fetch.ts` makes the fetch they call from `clients/environments.json`. Run it after any route change (`aggregate-create` runs it for the routes it adds); CI's `check` job fails while the committed files are stale. `template-upgrade` leaves `openapi.json` and `sdk.ts` as the Project has them, so run it again after an upgrade.
- **The CLI** (`clients/cli`, published as `<project>-cli`) is a command named after the Project: `clients/cli/cli.ts` hands the SDK's copy of the OpenAPI document and the SDK's functions to `cliCreate` from `@n8io/baseline-cli`, so every operation is a command (`invoiceLineCreate` is `<project> invoice-line create --name x`) with no command code of the Project's own. A new route is a command once `sdk-generate` has run. Try it against `pnpm dev`: `node clients/cli/cli.ts login --client-id dev-client --env development`, then `node clients/cli/cli.ts invoice-line list --env development`; `--url` overrides the Environment. `--help` lists the commands and flags; `@n8io/baseline-cli`'s README says how a command maps to its call, where the token and URL come from and what it prints.
- The image never holds `clients/` (`.dockerignore`).

## Publishing them

On every push to main, `.github/workflows/clients-release.yml` runs `scripts/clients-release.ts`, which publishes `clients/sdk` as `@<scope>/<project>-sdk` and `clients/cli` as `@<scope>/<project>-cli` when they changed. They go to GitHub Packages, the npm registry of the Project's own repository (`https://npm.pkg.github.com`), never to public npm: the SDK carries every Environment's URL from `clients/environments.json`, so whoever can install it can read them. The workflow and the script go with the `sdk` piece: `pnpm piece-remove sdk` deletes them. After `pnpm piece-remove cli`, only the SDK publishes. Until the repository variable `CLIENTS_NPM_SCOPE` is set, the workflow's `off` job passes and says why.

### Versions

Never pick a version by hand, and a Project has no changesets.

- Both packages publish at one version, the SDK first. The published CLI depends on exactly that SDK version, and the SDK on `@n8io/baseline-sdk` from public npm.
- The major is the API's: `info.version` in `clients/sdk/openapi.json` (`/api/v1` is 1.x). oasdiff already blocks a breaking change inside a major ([api.md](api.md)).
- The script compares the files with the newest version published in that major. A change to what the SDK can call (`openapi.json`, `sdk.ts`, `clients/environments.json`) publishes the next minor. Any other change (`sdk-fetch.ts`, `index.ts`, `cli.ts`, a dependency) publishes the next patch. No change publishes nothing, and with nothing published yet the version is `<major>.0.0`.
- A Project that published to public npm before starts again at `<major>.0.0` on GitHub Packages, a separate registry.
- An Environment's new URL is a new release: a caller gets it by upgrading the SDK, or passes `baseUrl` (`--url`) until then.
- The registry gets JavaScript built into `dist/` with type declarations, `environments.json`, the TypeScript sources beside them, and the repository named, which links the package to it.
- To see what would publish without publishing: `CLIENTS_NPM_SCOPE=<scope> node scripts/clients-release.ts --dry-run`.

### Turning it on

Set the repository variable `CLIENTS_NPM_SCOPE` to the repository's owner in lowercase, the only scope GitHub Packages takes for it (Settings, Secrets and variables, Actions, Variables). The workflow publishes with its own `GITHUB_TOKEN` (`packages: write`), so there is no token to store, no first publish by hand and no trusted publisher. Run the workflow by hand from the Actions tab to check it. A package published from a private repository is private, readable by whoever can read the repository.

### Installing them

Another repository, or a person, installs them like this:

1. A token that can read packages: a classic personal access token with `read:packages` (GitHub Packages' npm registry takes no fine-grained token), or the `GITHUB_TOKEN` of a workflow in a repository the package grants access to.
2. An `.npmrc` beside the consumer's `package.json`: `@<scope>:registry=https://npm.pkg.github.com` and `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}`, with the token in `NODE_AUTH_TOKEN`. The line sends every `@<scope>/` package to GitHub Packages, including the SDK's own dependency when the scope is also on public npm (`@n8io/baseline-sdk`): GitHub says it serves npmjs.org packages through its registry, but check that install before relying on it.
3. Another repository's CI: in the package's settings on GitHub (Manage Actions access), add that repository with read access; its workflow then installs with `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` and `packages: read`.
4. Dependabot in that repository: a `registries` entry of `type: npm-registry`, `url: https://npm.pkg.github.com`, `token: ${{ secrets.<NAME> }}` (a Dependabot secret holding a `read:packages` token), listed under the npm `updates` entry's `registries`.

### When a publish fails

- `E401`, `E403` or `ENEEDAUTH`: `CLIENTS_NPM_SCOPE` is not the repository's owner, the workflow lost `packages: write`, or a package of that name already belongs to another repository (give this one write access in the package's settings, or delete it).
- The SDK published and the CLI did not: the next run publishes both at the next patch.
- Check a release on the repository's Packages page; `npm view @<scope>/<project>-sdk versions --registry https://npm.pkg.github.com` needs the token too.
