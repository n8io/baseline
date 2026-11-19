# Context map

The bounded contexts of this app, the kind of subdomain each serves, and how they relate. [CONTEXT.md](CONTEXT.md) holds the architecture terms every context shares; each context's own language is linked below. The Shared kernel is the result, id and authn Packages. The format is in [docs/agents/context-create.md](docs/agents/context-create.md).

## Contexts

| Context | Subdomain | Language                                                   |
| ------- | --------- | ---------------------------------------------------------- |
| `foo`   | core      | [src/contexts/foo/CONTEXT.md](src/contexts/foo/CONTEXT.md) |

## Relationships

| Downstream | Upstream | Through |
| ---------- | -------- | ------- |
