---
"app": patch
---

The entry points' `*-open.ts` files add their shutdown step through one `resourceOpen` helper in `src/shutdown-step-add.ts`, instead of each spelling out the same step. No behaviour changes.
