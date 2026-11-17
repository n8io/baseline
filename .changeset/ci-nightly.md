---
"app": minor
---

A Project's CI runs every test nightly on main (07:17 UTC), since a pull request runs only the tests its diff reaches: the nightly run catches a test whose inputs a pull request's selection missed. It runs every job, about as many billed minutes as one pull request. Take it with `pnpm template-upgrade`; GitHub turns schedules off in a repository with no activity for 60 days.
