# Making a new repo from the app template

Research for [#21](https://github.com/n8io/baseline/issues/21). Date of research: 2026-11-01.

The question: new GitHub repos are made from `apps/app` alone, and they install the shared packages from GitHub Packages. GitHub's template feature copies a whole repo. What are the ways to make a repo from one folder, and how does each handle `workspace:*`, placeholders such as `foo`, later template changes, and an agent running it with no human at a terminal?

## Answer

Use two plain scripts and no new tool:

1. **`app-create`** (lives in this monorepo). It exports `apps/app` at a release tag, renders it with the answers (repo name, first domain name, later the mode from #8), writes those answers and the baseline commit to `.template.json`, and pushes it to a new private repo with `gh repo create --private --source <dir> --push`.
2. **`template-upgrade`** (ships inside the app, so it is upgraded too). It renders the old and the new baseline release with the saved answers, stores both as git commits in the project, and cherry-picks the difference. That is a real 3-way merge. Clean changes apply; overlapping changes become ordinary conflict markers for the agent to resolve.

The export step is `git archive HEAD:apps/app` for the files, plus the `package.json` that `pnpm pack` writes. pnpm already turns `workspace:` and `catalog:` into real versions when it packs, so we do not write that logic.

Both scripts were run end to end in a local experiment (below). No GitHub repos were created.

## Facts from primary sources

### GitHub template repositories

- A repo made from a template gets "the same directory structure and files" and "starts with a single commit". Only the default branch is copied unless "Include all branches" is chosen. [GitHub docs: Creating a repository from a template](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template)
- "Branches created from a template have unrelated histories", so you cannot open pull requests or merge between them. (same page)
- No option to pick a subfolder; the whole repo is copied. (same page, and the API below has no path parameter)
- API: `POST /repos/{template_owner}/{template_repo}/generate` with `owner`, `name`, `description`, `include_all_branches`, `private`. A private template can only be used by its owner or members of the owning org. The template must have `is_template: true`, which `PATCH /repos/{owner}/{repo}` sets. Classic tokens need `repo` scope for a private repo. [GitHub REST: Create a repository using a template](https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28#create-a-repository-using-a-template)
- Fine-grained tokens need Administration (write), Contents (read) and Repository creation (write) for that endpoint. [Permissions for fine-grained PATs](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
- `gh repo create` has `--template`, `--include-all-branches`, `--clone`, `--source` and `--push`. (`gh repo create --help`, gh 2.99.0)
- There is no variable substitution in GitHub templates. Templates that need it ship a workflow that runs on the first push in the new repo. Example: JetBrains' `intellij-platform-plugin-template` (3.7k stars, pushed 2026-10-17) has `template-cleanup.yml`, which runs `sed` over the files when `github.event.repository.name` is not the template's name, deletes itself and pushes with `GITHUB_TOKEN`. [template-cleanup.yml](https://github.com/JetBrains/intellij-platform-plugin-template/blob/main/.github/workflows/template-cleanup.yml)

### Tokens

- `GITHUB_TOKEN`: "The token's permissions are limited to the repository that contains your workflow." A workflow in this repo cannot push to another repo with it. [GitHub docs: GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)
- Classic `workflow` scope: "Grants the ability to add and update GitHub Actions workflow files." Without it, a push that adds `.github/workflows/*` is refused unless the same file already exists on another branch. [Scopes for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
- The gh token on this machine has scopes `gist`, `read:org`, `repo`. It lacks `workflow` (so it cannot push a new repo that contains workflow files) and `delete_repo` (so it cannot delete test repos). Checked with `gh auth status`.
- From [#6](https://github.com/n8io/baseline/issues/6): a new repo gets no access to the private `@n8io` packages until someone grants it per package in the UI, or it is given a classic `read:packages` PAT as a secret. This applies to every option below.

### pnpm and Changesets

- On `pnpm pack` or `pnpm publish`, `workspace:*`, `workspace:~` and `workspace:^` become the target package's version, `*` as an exact version and `^`/`~` as that range. [pnpm: Workspace, Publishing workspace packages](https://pnpm.io/workspaces)
- "The `catalog:` protocol is removed when running `pnpm publish` or `pnpm pack`" and replaced by the catalog's range. [pnpm: Catalogs](https://pnpm.io/catalogs)
- Changesets publishes through pnpm when the repo uses pnpm (`getPublishTool.ts` picks `pnpm.publish`), so packages get the same rewrite. [changesets source](https://github.com/changesets/changesets/blob/main/packages/cli/src/commands/publish/getPublishTool.ts)
- Changesets can version and tag private packages with `"privatePackages": { "version": true, "tag": true }`. That gives `apps/app` its own version, tag and changelog, which `template-upgrade` can target. [changesets config options](https://github.com/changesets/changesets/blob/main/docs/config-file-options.md)
- Current versions (npm registry, 2026-11-01): pnpm 12.16.1 (`latest`), `@changesets/cli` 3.0.3, turbo 2.11.10.

### Tools considered

| Tool | What it is | Health (2026-11-01) |
|---|---|---|
| [Copier](https://copier.readthedocs.io/en/stable/) | Python template tool with `copier update` | 9.19.1 (2026-10-13), 3.7k stars, active |
| [cruft](https://github.com/cruft/cruft) | Adds updates to Cookiecutter | 2.16.0, last push 2024-12-25 |
| [degit](https://github.com/Rich-Harris/degit) | Downloads a repo or subfolder without history | 3.10.1 (2026-10-21), 8k stars, revived in 2026 after years idle |
| [tiged](https://github.com/tiged/tiged) | degit fork | 2.12.8, last push 2026-06-16 |
| [actions-template-sync](https://github.com/AndreasAugustin/actions-template-sync) | Action that opens PRs with template changes | v2.6.0 (2026-09-06), 327 stars |
| `create-*` package | Published CLI, like `create-vite` | pattern, not a tool |

## The options

### A. Mirror `apps/app` into a separate template repo, then `gh repo create --template`

A workflow in this repo runs after each release. It exports `apps/app`, commits it to `n8io/baseline-app` (marked `is_template`), and agents run `gh repo create n8io/<name> --private --template n8io/baseline-app`.

- **`workspace:*`**: the workflow does the export (pack plus archive, as below), so the mirror holds real versions.
- **Placeholders**: GitHub does none. Needs a cleanup workflow in the template (JetBrains pattern) or the agent runs a rename script after cloning.
- **Upgrades**: the new repo's history is unrelated to the template's, so `git merge` does not work. `actions-template-sync` merges unrelated histories into a PR, but it knows nothing about our renames, so every renamed file conflicts. A render-and-merge script (option C's) still needs to be written.
- **Unattended**: yes, but the workflow needs a PAT or GitHub App token with Contents and Workflows write on the mirror, because `GITHUB_TOKEN` cannot reach another repo. One more repo and one more secret to keep alive.
- **Dependencies**: none new. One extra repo.
- **Good parts**: a "Use this template" button; GitHub copies server side; the mirror can run its own CI to prove the exported app installs from GitHub Packages and passes.

### B. A `create-*` package (`pnpm create @n8io/app`)

A package in this monorepo bundles the app files and a script, published to GitHub Packages.

- **`workspace:*`**: the template's `package.json` is a file inside the package, not its manifest, so pnpm does not rewrite it. The build step must do the pack trick anyway.
- **Placeholders**: the script asks or takes flags. Easy.
- **Upgrades**: none built in. Same script as option C would be needed.
- **Unattended**: yes with flags. Needs registry auth to even download the creator.
- **Dependencies**: none new, but one more published package to version and test. Common in the JS world (`create-vite`, `create-next-app`), but those are for public, one-shot scaffolds.

### C. Plain scripts: `app-create` in the monorepo and `template-upgrade` in the app (recommended)

Described under Answer.

- **`workspace:*`**: `pnpm pack` rewrites it. Verified.
- **Placeholders**: a small Node script replaces `foo`/`Foo`/`FOO` in paths and contents and sets the package name. Verified.
- **Upgrades**: render old and new release with saved answers, cherry-pick the difference. Verified for a clean merge, a package bump, a new file, and a conflict.
- **Unattended**: yes. The agent needs `workflow` scope on its gh token once (`gh auth refresh -s workflow`, a device code the user can enter from a phone), plus the package access from #6.
- **Dependencies**: none. git, pnpm, node and gh are already required.

### D. Copier

Add `copier.yml` at the monorepo root with `_subdirectory: apps/app`.

- **`workspace:*`**: Copier copies files as they are; a `_tasks` step must run the rewrite, and tasks need `--trust`.
- **Placeholders**: only in files ending in `.jinja` (the default `_templates_suffix`) or in Jinja file names. That makes `apps/app` no longer a runnable app inside the monorepo, which breaks "package changes can be tested locally against it" from #20. Keeping `foo` as real code and renaming it in a task avoids that, but then Copier is doing little.
- **Upgrades**: the best of the options. `copier update` regenerates from the saved answers, diffs, applies migrations and writes inline conflict markers or `.rej` files. Needs git tags on the template. [Copier: Updating a project](https://copier.readthedocs.io/en/stable/updating/), [Configuring](https://copier.readthedocs.io/en/stable/configuring/)
- **Unattended**: yes, `--defaults --data name=value --trust`.
- **Dependencies**: Python plus Copier in a TypeScript stack. It is established, but not the common practice for TS projects, so it fails the few-dependencies rule.
- Not run in this research.

### E. degit or tiged

`degit n8io/baseline/apps/app my-app` copies a subfolder. degit 3 also has `degit.json` actions with `search_replace`. [degit USAGE.md](https://github.com/Rich-Harris/degit/blob/main/docs/USAGE.md)

- **`workspace:*`**: not handled.
- **Placeholders**: `search_replace` reads values from environment variables. Partial.
- **Upgrades**: none; it drops git history by design.
- **Unattended**: yes. Private repos fall back to SSH clone.
- **Dependencies**: one new tool that adds nothing `git archive` plus a script cannot do. degit was idle for years and came back in 2026, so its health is uncertain.

## Experiment

Scratch dir: `/private/tmp/claude-501/-Users-n8-code-n8io-baseline/template-exp/` (not in the repo). Node 26.5.0, pnpm 12.16.1 via `npx`.

Setup: a monorepo with `packages/core` (1.4.2), `packages/web` (0.3.0), a catalog entry `zod: ^4.6.7`, and `apps/app` (private) depending on `@n8io/core: workspace:*`, `@n8io/web: workspace:^`, `zod: catalog:`, with `src/domains/foo/`, `.github/workflows/ci.yml`, `.npmrc` and `.gitignore`.

Results:

1. `pnpm pack` in a **private** package works, with no `pnpm install` first. It needs a `version` field (`ERR_PNPM_PACKAGE_VERSION_NOT_FOUND` without it). The packed `package.json` had `"@n8io/core": "1.4.2"`, `"@n8io/web": "^0.3.0"`, `"zod": "^4.6.7"`.
2. The tarball **left out `.npmrc` and `.gitignore`**. So pack is only used for the manifest; the files come from `git archive HEAD:apps/app`, which takes exactly the tracked files.
3. `pnpm pack` writes a `pnpm-lock.yaml` at the workspace root as a side effect. Run it in a throwaway clone.
4. The rename script turned `src/domains/foo/foo-create.ts` into `src/domains/widget/widget-create.ts`, `Foo` into `Widget`, `FOO_NAME_MAX` into `WIDGET_NAME_MAX`, and set `"name": "widget-api"`.
5. Upgrade, clean case: the project added a line to `widget-create.ts` and `ci.yml`. The template then bumped `@n8io/core` to 1.5.0, changed `FOO_NAME_MAX`, added a comment to `foo-create.ts` and added `src/health.ts`. The upgrade applied all four to the renamed files, kept the project's lines, and updated `.template.json`.
6. Upgrade, conflict case: project and template both changed `WIDGET_NAME_MAX`. The cherry-pick stopped with standard conflict markers (`<<<<<<< HEAD … >>>>>>>`) and exit code 1.
7. The same upgrade ran straight from the monorepo's history (export at the old and new commit), with no mirror repo. That is the version recommended.

The core of the upgrade script (bash, no dependencies):

```bash
tree_of() { # render the template at commit $1 and store it as a tree in this repo
  git -C "$tmp/b" checkout -qf "$1"; git -C "$tmp/b" clean -fdq
  export_app "$tmp/b" "$tmp/x" && node render.ts "$tmp/x" "$tmp/r" "$name" "$domain"
  GIT_INDEX_FILE="$tmp/index" GIT_WORK_TREE="$tmp/r" git add -A >/dev/null
  GIT_INDEX_FILE="$tmp/index" git write-tree; rm -f "$tmp/index"
}
base=$(git commit-tree "$(tree_of "$old")" -m "baseline $old")
next=$(git commit-tree "$(tree_of "$new")" -p "$base" -m "baseline $new")
git cherry-pick --no-commit "$next"   # 3-way merge: base = old render, ours = HEAD, theirs = new render
```

Not verified (needs real repos, and this token cannot delete them):

- `gh repo create --source --push` failing without `workflow` scope. The scope docs say so; not tried.
- Whether the generate API (option A) copies workflow files without `workflow` scope.
- Installing the exported app against the real GitHub Packages registry and producing its own lockfile.

## Recommendation

Option C. It adds no dependency, keeps one source of truth (this monorepo), needs no second repo or cross-repo secret, and reuses pnpm's own rewrite. It also answers "Template upgrades" with the same mechanism Copier uses, in about 40 lines we can read.

Details the spec should settle:

- `apps/app` declares `workspace:^`, not `workspace:*`, so new repos get caret ranges that Dependabot or Renovate can bump. `*` packs to an exact pin.
- `apps/app` has a `version` and is versioned and tagged by Changesets (`privatePackages`). `.template.json` records the release tag, not a bare commit, and the upgrade targets the next tag. Its changelog says what changed.
- `.template.json` holds every answer: name, domain, and the mode from #8. Upgrades re-render with it. Agents never edit the rendered files to fake an answer.
- The export writes what the monorepo root normally provides: the app's own `pnpm-workspace.yaml` settings (pnpm keeps settings there), `packageManager`, and `.npmrc`.
- Shared package updates arrive through Dependabot or Renovate, not through `template-upgrade`. The upgrade only carries files that are not in a package, which is the definition of the fog.
- A CI job in this monorepo renders the app into a temp dir with sample answers and runs its typecheck and tests, so a broken export or rename fails here first.
- The rename replaces plain `foo`, so no other word in the template may contain `foo` (`footer`, `football`). The CI job above catches a slip because the renamed code would not typecheck, but only if the slip is in code.

## Strongest case against

Copier already does the upgrade part well, and our script is new code. Copier handles migrations between versions, deleted and moved files, skip-if-exists files and `.rej` output, and has years of bug reports behind it. Our script will meet those cases one at a time. If upgrades turn out frequent and messy, the honest fallback is Copier with `_subdirectory: apps/app` and the rename as a task, and we accept Python in the toolchain.

The second case against is option A's mirror repo: a "Use this template" button and a browsable, CI-tested copy of the exported app. Nothing in #20 needs the button, since agents create repos, and the CI job above gives the same proof without a second repo.

## Effect on other open questions

- **Template upgrades (map #1 fog)**: settled by `template-upgrade`, a render-old, render-new, 3-way merge from saved answers and a Changesets tag for `apps/app`. Package changes stay with the package manager.
- **Adding and removing the frontend or backend ([#8](https://github.com/n8io/baseline/issues/8))**: the mode becomes one answer in `.template.json`. Switching mode later is the same merge with the old answers as the base and the new answers as the target (a small change to the script; not tested). That works cleanly only if each mode differs by whole files, folders and dependencies, not by conditionals inside shared files. #8 should design the modes that way.
