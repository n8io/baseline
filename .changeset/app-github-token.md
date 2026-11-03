---
"app": minor
---

Projects install the baseline packages with the built-in GITHUB_TOKEN instead of a personal access token: the template CI grants `packages: read` and Dependabot needs no registry block.
