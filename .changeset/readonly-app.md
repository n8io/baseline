---
app: minor
---

The Template's domain types are readonly: `Foo`, `Bar`, their inputs and Events are `Readonly<z.infer<...>>`, `FooList.items` is `readonly Foo[]`, and `listByFooId` and `bar-list` return `readonly Bar[]`. The memory repository stores a new Foo instead of editing one. A Project that edits a Foo or a returned list copies it first. A root test (`test/readonly-types.test.ts`) fails a mutable array, Map or Set in an exported Package signature.
