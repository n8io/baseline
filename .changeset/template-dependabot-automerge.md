---
"app": minor
---

Projects keep their dependencies up to date by themselves: Dependabot waits 7 days before offering a release (baseline packages excepted), groups patch and minor updates, and a new `automerge` CI job merges every update PR that is not a major once CI passes.
