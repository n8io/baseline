---
"app": major
---

The shared `app-ci.yml` runs the `migrations` and `oasdiff` checks as steps of the `check` job, so a Project's CI has six required checks instead of eight: `ci / check`, `unit`, `integration`, `pieces`, `image` and `sast`. Each job bills at least one minute and spends about 25 s on setup, while the migrations steps take about 2 s and oasdiff about 16 s, so the run bills two minutes fewer. Every step of `check` after `pnpm check` now reports even when an earlier one failed, and the job limit goes from 3 to 5 minutes.

To upgrade a Project, in this order (the ruleset first: it only drops `ci / migrations` and `ci / oasdiff`, which the old workflow still produces, so main and open pull requests stay mergeable; a 9.x workflow under the old ruleset would wait forever for those two):

1. In a baseline clone at 9.0.0 or later, from inside the Project's clone: `pnpm -C <baseline clone> app-create --github-only`. It prints `Updated the ci ruleset on <owner>/<repo>: changed rule required_status_checks (removed ci / migrations, ci / oasdiff)`. A Project with its own extra required checks, or a ruleset not named `ci`, removes those two contexts from its ruleset by hand instead.
2. `pnpm template-upgrade --to 9.0.0`; it takes `.github/workflows/ci.yml` (the pin moves to `app-ci.yml@v9`) and the docs that named the old jobs.
