---
"app": minor
---

A Domain's entry exports its error statuses and its "can" predicates, so a page copies neither.

- `src/domains/foo/foo-error-status.ts` (moved from `api/`, a Domain root may now hold `<domain>-error-status.ts`) is typed against `FooError["type"]` and exported from `index.ts` with `fooUpdateCan` and `fooDeleteCan`. The routes still check it against `HttpErrorStatus<FooError>`.
- `foo-detail.tsx` shows the update form and the Delete control only when the Rule allows them, and takes every Foo error status from `fooErrorStatus`.

Foo is not in a Project, so apply this by hand: move your `api/<domain>-error-status.ts` to the Domain root, export it and your `<domain>UpdateCan`-style Rules from `index.ts`, and use them in your pages. Take `structure.test.ts` from the Template.
