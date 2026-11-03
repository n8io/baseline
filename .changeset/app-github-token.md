---
"app": minor
---

Projects install the baseline packages with the built-in GITHUB_TOKEN instead of a PACKAGES_TOKEN secret: the template CI grants `packages: read` and Dependabot needs no registry block.
