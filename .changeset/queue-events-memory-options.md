---
"@n8io/baseline-queue": major
"app": major
---

`queueEventsMemoryCreate` takes one options object, like every other factory: `queueEventsMemoryCreate({ published })`. `published` is optional and so is the whole argument, so `queueEventsMemoryCreate()` still works. A call that passes the array on its own no longer compiles.

In the Template, `foo-transaction.memory.ts` passes `{ published: pending }`. When you upgrade, make the same change in every Domain's `spi/<domain>-transaction.memory.ts`: `queueEventsMemoryCreate<…>(pending)` becomes `queueEventsMemoryCreate<…>({ published: pending })`.
