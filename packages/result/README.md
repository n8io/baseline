# @n8io/baseline-result

`Result`, `ok` and `err`: use cases return expected business errors as values and throw only for the unexpected.

```sh
pnpm add @n8io/baseline-result
```

## Exports

- `Result<T, E>`: `{ ok: true, value: T }` or `{ ok: false, error: E }`.
- `ok(value)`: the success case.
- `err(error)`: the failure case. By convention `error` is an `Error` subclass with a literal `type` field, such as `FooNotFoundError` below, so callers switch on `type` and logs keep a stack.

## Example

```ts
import { err, ok, type Result } from "@n8io/baseline-result";

class FooNotFoundError extends Error {
  readonly type = "FooNotFound";
  readonly fooId: Id<"foo">;
  constructor(fooId: Id<"foo">) {
    super(`Foo ${fooId} not found`);
    this.fooId = fooId;
  }
}

const fooGet = async (
  fooId: Id<"foo">,
): Promise<Result<Foo, FooNotFoundError>> => {
  const foo = await fooRepository.get(fooId);
  return foo ? ok(foo) : err(new FooNotFoundError(fooId));
};

const result = await fooGet(fooId);
if (!result.ok) return result.error.type; // "FooNotFound"
result.value.name;
```

## Needs

Nothing: no dependencies, peers or env.
