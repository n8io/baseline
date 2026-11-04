---
"app": patch
---

`pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`, so pnpm refuses any release younger than a day. `@n8io/baseline-*` packages are exempt.
