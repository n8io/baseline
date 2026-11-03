---
"app": patch
---

Projects run CI through `app-ci.yml@v1`: the app ships `.github/workflows/ci.yml`, `.github/dependabot.yml`, a `test:mutation` script (Stryker on changed files) and a `ci` script.
