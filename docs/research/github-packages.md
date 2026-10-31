# Publishing private packages to GitHub Packages

Ticket: n8io/baseline#6. Researched 2026-10-31 against primary docs. Items marked **(unverified)** were not confirmed in a primary source during this pass.

## Recommendation

Publish from one release workflow with `changesets/action` and the workflow's `GITHUB_TOKEN`. Consumers (template-made repos) install with a **classic** PAT that has only `read:packages`, kept in a user-level `~/.npmrc` or env var, never a committed token. Fine-grained PATs do not work for GitHub Packages today. To avoid sharing a long-lived human PAT, grant each consuming repo read access to each package under "Manage Actions access", so CI and Dependabot use `GITHUB_TOKEN` instead.

## Facts

### Tokens
- The GitHub Packages npm registry supports only personal access tokens (classic); the docs do not mention fine-grained tokens. Scopes: `read:packages` (install), `write:packages` (publish), `delete:packages`. [npm registry docs](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry), [permissions docs](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages)
- A feature request for fine-grained PAT support was filed on 2026-10-20 with no GitHub response yet, so it is still unsupported. [community#210789](https://github.com/orgs/community/discussions/210789)
- `GITHUB_TOKEN` can publish and install packages associated with the workflow's repository. For registries with granular permissions the docs recommend it over PATs. [Actions guide](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions)

### Naming and linking
- Only scoped packages; the scope must equal the owning account, lowercase. `@n8io/<name>` works because the owner is the user `n8io`. [npm registry docs](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)
- `package.json` `repository` must be the GitHub repo URL. GitHub uses it to link packages to the repo (many packages can link to one repo). Linked packages inherit the repo's access and its workflows get access (unless inheritance is off). Same source.
- Set `publishConfig.registry` to `https://npm.pkg.github.com` in each package, or use a project `.npmrc` line `@n8io:registry=https://npm.pkg.github.com`. Committing the registry line is recommended. Same source.
- Tarball limit 256MB. New packages are private by default. Same source.

### Personal account vs org
- Personal-account packages offer only Public or Private visibility (no Internal). Making one public is irreversible. Access can be granted to individual users only; teams cannot be given access. [Access control docs](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
- Visibility is never inherited from the repo. Permissions are inherited only if the repo is linked before first publish, or inheritance is turned on later. Same source.
- Transferring a repo: granular packages keep their owner but lose the repo link, so linked workflows lose access. [Permissions docs](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages)
- Org-only conveniences (org owners disabling inheritance for new packages, team roles) do not apply to `n8io`.

### Repos created from this template
- A repo made from the template is a different repo with its own `GITHUB_TOKEN`. It has no access to `@n8io/*` packages by default. Fix, per package: package settings > "Manage Actions access" > Add repository > role Read. This is separate from linking, and is a manual step per package per consuming repo (only a UI path is documented; no API found, **unverified**). [Access control docs](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
- Alternative that avoids per-repo grants: one classic PAT with `read:packages`, stored as an Actions secret (and Dependabot secret) in each consuming repo. It is tied to the owner's account and must be rotated.
- The registry requires auth even to read public packages (only GHCR allows anonymous pulls). [Permissions docs](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages)
- Local installs always need a token: a developer's `~/.npmrc` holds `//npm.pkg.github.com/:_authToken=...`.

### pnpm
- pnpm does not expand `${NAME}` in a project `.npmrc` for registry URLs, proxies, `//` keys or credentials such as `_authToken`. It ignores them with a warning. `${NAME}` substitution works only in user-level files (`~/.npmrc`, `<pnpm config>/auth.ini`). Opt-in: `PNPM_CONFIG_NPMRC_AUTH_FILE=.npmrc` trusts the project file (advised only for fully trusted repos). [pnpm npmrc docs](https://pnpm.io/npmrc)
- This breaks the common pattern of a committed `.npmrc` containing `_authToken=${NPM_TOKEN}`. In CI, write the token to the user-level `~/.npmrc` (what `actions/setup-node` with `registry-url` does, **unverified here**) and keep only the `@n8io:registry=` line in the repo. The pnpm page's wording on registry URLs in the project file is ambiguous, so test this in the first build.
- `pnpm -r publish` skips versions already published. It checks git branch and cleanliness by default (`--no-git-checks` skips; a detached HEAD in CI skips the branch check). [pnpm publish](https://pnpm.io/cli/publish)
- How `workspace:` deps are rewritten on publish was not covered by the page fetched (**unverified**; confirm in the first build).

### Changesets
- `changeset publish` publishes each package whose version is not on the registry, runs `pnpm publish` when pnpm is detected, and creates local git tags (`pkg@version` in monorepos) that must be pushed. The CLI page is marked outdated. [changesets CLI docs](https://github.com/changesets/changesets/blob/main/docs/command-line-options.md)
- `changesets/action` needs `contents: write` and `pull-requests: write`, plus the repo setting "Allow GitHub Actions to create and approve pull requests". `id-token: write` is only for npm trusted publishing. Its README says nothing about GitHub Packages, `NPM_TOKEN` or `.npmrc`, so registry auth is entirely the workflow's job. [changesets/action](https://github.com/changesets/action/blob/main/README.md)
- Add `packages: write` to the release job's `permissions` for `GITHUB_TOKEN` publishing.
- A PR created with `GITHUB_TOKEN` does not trigger other workflows (known GitHub behavior, **unverified** here). If checks must run on the version PR, pass another token via the action's `github-token` input.
- Packages that must publish cannot have `"private": true` (Changesets skips those; **unverified** here). Keep the app in `apps/` private. "Private" in this ticket means registry visibility, not the `package.json` flag.

### Dependabot
- For GitHub Packages, Dependabot authenticates with its own `GITHUB_TOKEN` when the repo has been granted access under "Manage Actions access". No PAT or `dependabot.yml` entry is needed then. [Dependabot private registries](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/configuring-access-to-private-registries-for-dependabot), [access control docs](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
- If a PAT is used: `type: npm-registry`, `url: https://npm.pkg.github.com` (no path), `token: ${{secrets.X}}`, `replaces-base: true`. The registry must be declared in `dependabot.yml` even if it is in `.npmrc`. The secret must be a Dependabot secret; workflows triggered by Dependabot PRs also read Dependabot secrets. Same Dependabot doc.
- Whether Dependabot works with the committed pnpm `.npmrc` was not tested.

### Renovate
- Renovate auto-creates a hostRule for `*.pkg.github.com` using the platform token, so lookups usually work if that token can read the package. Overrides use `hostType: npm`, `matchHost: https://npm.pkg.github.com/`. [Renovate private packages](https://docs.renovatebot.com/getting-started/private-packages/)
- Mend-hosted app: the token goes in the app's Credentials UI (`{{ secrets.NAME }}`); encrypted secrets in config are no longer supported. Setting `npmrc` in config makes Renovate ignore the repo `.npmrc` unless `npmrcMerge: true`. Same source.
- Whether the Renovate platform token reads packages in template-made repos without a grant is **unverified**; assume the same "Manage Actions access" grant or a classic PAT is needed.

## What breaks or is awkward
1. Fine-grained PATs are unsupported, so every human or bot credential is a classic PAT tied to a person (`read:packages` reads all packages that account can see).
2. Template-made repos start with no package access, and the grant is a manual UI step per package per repo.
3. pnpm ignores `${VAR}` credentials in a project `.npmrc`, so the usual committed token reference fails.
4. Personal account: no teams, no Internal visibility; sharing with collaborators means inviting each person to each package.
5. Repo transfer breaks the repo-to-package link.
6. Changesets docs do not cover non-npm registries; the first release run is the real test.
7. Even local installs need a token; there is no anonymous read.

## Open items for later decisions
- One shared classic read PAT per consuming repo (simple, a secret to rotate) versus per-repo Actions access (no secret, manual grants).
- Whether the template ships an `.npmrc` with only the `@n8io:registry` line plus docs for the user-level token.
- Verify in the first real release: `workspace:` rewrite, user-level `.npmrc` from `setup-node`, Dependabot against the committed `.npmrc`.
