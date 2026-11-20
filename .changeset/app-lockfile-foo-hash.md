---
"app": patch
---

app-create no longer renders the Template's `pnpm-lock.yaml`, whose integrity hashes can hold "Foo" by chance. The render dropped such a line, so pnpm ignored the broken lockfile and a new Project resolved every dependency fresh.

To upgrade a Project: nothing is required.
