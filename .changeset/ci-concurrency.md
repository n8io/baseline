---
"app": patch
---

The Project's `ci` workflow cancels a superseded run on the same ref, so a second push to a pull request stops the first run. Runs on `main` never cancel each other.
