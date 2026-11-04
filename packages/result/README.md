# @n8io/baseline-result

`Result`, `ok` and `err`: use cases return expected business errors as values and throw only for the unexpected.

```sh
pnpm add @n8io/baseline-result
```

## Exports

- `Result<T, E>`: `{ ok: true, value: T }` or `{ ok: false, error: E }`.
- `ok(value)`: the success case.
- `err(error)`: the failure case. By convention `error` is a tagged object such as `{ type: "FooNotFound" }`.

## Example

```ts
import { err, ok, type Result } from "@n8io/baseline-result";

type FooError = { type: "FooNotFound" };

const fooGet = async (fooId: Id<"foo">): Promise<Result<Foo, FooError>> => {
  const foo = await fooRepository.get(fooId);
  return foo ? ok(foo) : err({ type: "FooNotFound" });
};

const result = await fooGet(fooId);
if (!result.ok) return result.error.type; // "FooNotFound"
result.value.name;
```

## Needs

Nothing: no dependencies, peers or env.
