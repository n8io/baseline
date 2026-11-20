# Foo

Subdomain: core

The Template's example bounded context. It holds two Aggregates, Foo and Bar, and shows every pattern a context uses. A Project never contains it.

## Language

**Foo**:
The Template's example bounded context, `foo`, and its Aggregate root: a named record that shows every pattern a context uses. A Project never contains it: it starts with no context, `context-create` copies foo's context-level files under a new context's name, and `aggregate-create` copies Foo under each new Aggregate's name.
_Avoid_: widget, example, sample

**Bar**:
The Template's second example Aggregate in `foo`: a short note on one Foo, deleted with its Foo in the same transaction. It shows a context holding several Aggregates and a transaction across two under an invariant. Neither command copies it.
