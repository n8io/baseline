---
"app": patch
---

The template scripts remove their temp folders with `using` and `fs.mkdtempDisposableSync` instead of `try`/`finally`. No behaviour change.
