---
"app": major
---

The Template uses plain, model-first terms (ADR 0012). Aggregate, Aggregate root and Entity become Model; Transition becomes Model function, and a predicate is a model function named model first, then `Is`, `Has` or `Can` (`fooCanUpdate`, `fooCanDelete`); Composition root becomes Entry point; Published language becomes Public contract; Part becomes Option. The Seam, Module, Interface, Intake, Specification and Subdomain glossary entries are gone. `pnpm aggregate-create` is now `pnpm model-create`, its `aggregate-create-start:` markers are `model-create-start:`, and `AggregateOption` is `ModelOption`. Architecture rule A23 now fails a predicate that does not read model first (`invoicePaidIs`), and the A28 and A29 messages say Model.

To upgrade a Project: run `pnpm template-upgrade`; it will conflict on `CONTEXT.md` because the glossary changed, so take the Template's terms and keep your own context terms. The `CONTEXT-MAP.md` table lost its Subdomain column; drop it from your copy. Use `pnpm model-create` instead of `pnpm aggregate-create`. Rename your predicates to model first (`invoiceDeleteCan` to `invoiceCanDelete`, `invoicePaidIs` to `invoiceIsPaid`) and update their callers; `pnpm check` lists each A23 hit. Update your own glossary and docs to the new terms.
