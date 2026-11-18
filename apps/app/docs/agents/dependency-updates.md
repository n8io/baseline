# Walkthrough: dependency updates

Read when adding a dependency, handling a Dependabot pull request, a major update or a security alert, or when someone asks to be walked through how updates land. To start one, ask your agent: "Walk me through this dependency update with docs/agents/dependency-updates.md."

## How to guide

- Take one step at a time. Say what the step does and why, show the command, and run it only after the person says go.
- After each step, show what changed and how to tell it worked. Stop at the first failure and explain it before you try anything else.
- Ask before merging a major update: it is the one kind a person decides on.
- End by summarising what was updated and anything left for later.

## Adding a dependency

Adding one is a stop-and-ask (`AGENTS.md`). Every runtime dependency (`dependencies`, `peerDependencies`, `optionalDependencies`) also needs an entry in `dependencies-allowed.json`: its name and a one-line reason, such as `"pg": "the Postgres driver"`. `dependencies-allowed.test.ts` fails on one without, and on an entry no runtime dependency uses. Only an established, industry-standard library qualifies, and never a second one for a job a listed one does (a retry helper, a Result type, another schema library). `@n8io/baseline-*` packages need no entry; `pnpm piece-remove` drops a removed piece's entries. A version update changes no entry.

## Steps

1. **How updates arrive.** Read `.github/dependabot.yml` with the person. Dependabot checks weekly and proposes only releases at least 7 days old; security updates skip that wait. pnpm's `minimumReleaseAge` in `pnpm-workspace.yaml` still holds every install back one day, so a release hijacked on day zero never lands.
2. **Sort the PR.** Minor and patch updates come grouped in one PR; each major is its own PR; `@n8io/baseline-*` updates come grouped and skip the 7-day wait.
3. **Minor and patch.** CI runs every required check, then the `automerge` job squash-merges the PR. Nothing to do unless a check fails; if one does, find the update that broke it and fix the code or hold that update back.
4. **Major.** Read the release notes and the breaking changes with the person, check out the branch, apply what the notes require, commit, and run `pnpm run ci`. Merge by squash once green, after the person agrees.
5. **A major of `app-ci.yml`.** Dependabot proposes moving `.github/workflows/ci.yml` to the next `app-ci.yml@v<major>`. A new major can add a check that can fail, or add, rename or remove a required check; read the Template changelog, do any step it says comes first (such as moving the ruleset), and take the matching `pnpm template-upgrade` ([walkthrough](template-upgrade.md)) before merging this PR.
6. **A failed security update.** When Dependabot ends with `security_update_not_possible` (usually an indirect dependency), the alert is a ticket, not noise: refresh the lockfile by hand with `pnpm update <package> --depth Infinity`, or bump the direct parent; use an `overrides` entry in `pnpm-workspace.yaml`, with a comment saying why, only when the parent's range blocks the fix.
7. **No release.** Update PRs carry no changeset, so they publish nothing and tag nothing.

## When app-ci.yml moves under an open pull request

Each Template release moves the `app-ci.yml@v<major>` tag. Re-running failed jobs, or one job, keeps the workflow version of the first attempt; to get the moved tag, re-run all jobs, merge main into the branch, or push a commit (on a Dependabot PR, comment `@dependabot rebase`). A `workflow_dispatch` run does not clear a cancelled required check on the pull request.

## Semgrep rules

`ci / sast` scans with a pinned snapshot of Semgrep's `p/typescript`, `p/nodejs`, `p/react` and `p/secrets` packs, never fetched live from semgrep.dev: baseline's `.github/semgrep/rules.txt` names one commit of github.com/semgrep/semgrep-rules and the rule files, and each scan fetches them from there, so `sast` needs github.com and raw.githubusercontent.com. A new upstream rule cannot fail a pull request on its own; Dependabot does not move this pin.

- **Who moves it.** A baseline maintainer, by hand, in a baseline pull request. A Project gets the new snapshot with its next `app-ci.yml` release.
- **How.** In baseline, `node scripts/semgrep-rules-write.ts <semgrep-rules commit>` rewrites `.github/semgrep/rules.txt` from today's packs at that commit of github.com/semgrep/semgrep-rules. Then run `sh .github/semgrep/rules.sh .github/semgrep/rules.txt <dir>` and `semgrep scan --no-rewrite-rule-ids --config <dir>` on baseline's `packages scripts test`, a rendered Template and each known Project, before and after. Commit the new `rules.txt` with a changeset.
- **New findings.** A bump that adds a finding is a new failing check: it ships with the fixes in the same release, or waits for the next major.
