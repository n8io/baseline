# Foo

The Template's example bounded context. It holds two Models, Foo and Bar, and shows every pattern a context uses. A Project never contains it.

## Language

**Foo**:
The Template's example bounded context, `foo`, and its Model: a named record that shows every pattern a context uses. A Project never contains it: it starts with no context, `context-create` copies foo's context-level files under a new context's name, and `model-create` copies Foo under each new Model's name.
_Avoid_: widget, example model, sample model

**Bar**:
The Template's second example Model in `foo`: a short note on one Foo, deleted with its Foo in the same transaction. It shows a context holding several Models and a transaction across two under an invariant. Neither command copies it.
