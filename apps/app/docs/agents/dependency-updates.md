# Walkthrough: dependency updates

Read when handling a Dependabot pull request, a major update or a security alert, or when someone asks to be walked through how updates land. To start one, ask your agent: "Walk me through this dependency update with docs/agents/dependency-updates.md."

## How to guide

- Take one step at a time. Say what the step does and why, show the command, and run it only after the person says go.
- After each step, show what changed and how to tell it worked. Stop at the first failure and explain it before you try anything else.
- Ask before merging a major update: it is the one kind a person decides on.
- End by summarising what was updated and anything left for later.

## Steps

1. **How updates arrive.** Read `.github/dependabot.yml` with the person. Dependabot checks weekly and proposes only releases at least 7 days old; security updates skip that wait. pnpm's `minimumReleaseAge` in `pnpm-workspace.yaml` still holds every install back one day, so a release hijacked on day zero never lands.
2. **Sort the PR.** Minor and patch updates come grouped in one PR; each major is its own PR; `@n8io/baseline-*` updates come grouped and skip the 7-day wait.
3. **Minor and patch.** CI runs every required check, then the `automerge` job squash-merges the PR. Nothing to do unless a check fails; if one does, find the update that broke it and fix the code or hold that update back.
4. **Major.** Read the release notes and the breaking changes with the person, check out the branch, apply what the notes require, and run `pnpm run ci`. Merge by squash once green, after the person agrees.
5. **A major of `app-ci.yml`.** Dependabot proposes moving `ci.yml` from `app-ci.yml@v3` to `@v4`. A new major means a new check that can fail; read the Template changelog, and take the matching `pnpm template-upgrade` ([walkthrough](template-upgrade.md)) first.
6. **No release.** Update PRs carry no changeset, so they publish nothing and tag nothing.
