# Walkthrough: ship a change in baseline

Read when someone asks how to get a change to a Package, the Template or `app-ci.yml` released, or asks to be walked through a Release. To start one, ask your agent: "Walk me through shipping this change with docs/agents/release.md."

## How to guide

- Take one step at a time. Say what the step does and why, show the command, and run it only after the person says go.
- After each step, show what changed and how to tell it worked. Stop at the first failure and explain it before you try anything else.
- Ask before anything that cannot be undone: merging the Version packages PR publishes to npmjs, and a published version cannot be reused.
- End by summarising what was released and where Projects pick it up.

## Steps

1. **Branch and change.** Work on a branch; main takes changes only through pull requests. Run the Verify commands in [AGENTS.md](../../AGENTS.md) on what you touched.
2. **Changeset.** A change that should ship needs one: `pnpm changeset`, pick each Package it touches, plus `app` for a Template change. Help the person pick patch, minor or major: a change that breaks a Package's exports, or a Template change Projects must adapt to, is major. Dependency update PRs carry none, so they never release.
3. **Pull request and CI.** `ci.yml` runs `packages` (check, test and build on what changed), `sast`, `integration` (the Template with Foo) and `render`. `render` builds a real Project, the previous release upgraded to this change with `template-upgrade` plus two new Domains, and `render-and-test` runs the whole `app-ci.yml` on it. `glossary-check` only warns. Check: every required check is green.
4. **Merge.** Squash only, no approval needed once green.
5. **Version packages PR.** `release.yml` runs on main and opens or updates "🔖 Version packages" with the new versions and changelogs, then starts `ci.yml` on it (its own pushes start no CI). Show the person the version bumps before merging. The bot's own `action_required` runs on that PR do not block it.
6. **Release.** Merging the Version packages PR publishes each changed Package to npmjs by trusted publishing with provenance, and tags `app@x.y.z` when the Template changed. Check: `git ls-remote origin 'refs/tags/app@*'` lists the tag, and `https://registry.npmjs.org/@n8io/baseline-<name>/<version>` answers (it can lag a few minutes).
7. **`v<major>` moves.** The next `release.yml` run, with no changesets left, points the `v<major>` tag at the newest `app@<major>.x.y`. Projects whose `ci.yml` calls `app-ci.yml@v<major>` run the new CI from then on, and take the new Template with `pnpm template-upgrade`. A check that could fail a Project that passed before never goes into the current `v<major>`; it ships as the next one. A Template major also starts a new `v<major>`, even when `app-ci.yml` is unchanged.
