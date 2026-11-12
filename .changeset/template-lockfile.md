---
"app": patch
---

A new Project now starts with the Template's own `pnpm-lock.yaml`, so its first install takes the versions the release was tested with instead of resolving every range fresh. A fresh resolution could fail on the day a dependency shipped: `minimumReleaseAge` let a package through whose platform binaries were published minutes later and were still too new. `pnpm template-upgrade` leaves a Project's lockfile alone; the next install updates only the ranges the release changed.
