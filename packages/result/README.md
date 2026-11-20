# @n8io/baseline-result

**Expected failures as values, so the type tells every caller what can go wrong.** `Result`, `ok` and `err`: Use cases return expected business errors and never throw for them; adapters throw for the unexpected.

```sh
pnpm add @n8io/baseline-result
```

## Guarantees

| You get                         | How                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Errors in the signature**     | `Result<T, E>` is `{ ok: true, value: T }` or `{ ok: false, error: E }`; TypeScript narrows on `ok`.                   |
| **Errors you can switch on**    | By convention `error` is an `Error` subclass with a literal `type`, so callers switch on `type` and logs keep a stack. |
| **Transactions that follow it** | `postgresTransactionRun` in `@n8io/baseline-postgres` commits on `ok` and rolls back on `err`.                         |
| **Nothing to install with it**  | No dependencies, no peers, no env.                                                                                     |

## Example

```ts
import { err, ok, type Result } from "@n8io/baseline-result";

class FooNotFoundError extends Error {
	readonly type = "FooNotFound";
}

const fooGet = async (fooId: Id<"foo">): Promise<Result<Foo, FooNotFoundError>> => {
	const foo = await fooRepository.get(fooId);
	return foo ? ok(foo) : err(new FooNotFoundError(`Foo ${fooId} not found`));
};

const result = await fooGet(fooId);
if (!result.ok) return result.error.type; // "FooNotFound"
result.value.name;
```

A test reads a Result as a value: `expect(await fooGet(missingId)).toMatchObject({ ok: false, error: { type: "FooNotFound" } })`.

## Reference

<details><summary><b>Exports</b></summary>

| Export         | Does                                                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Result<T, E>` | `{ ok: true, value: T }` or `{ ok: false, error: E }`.                                                                                                                           |
| `ok(value)`    | The success case.                                                                                                                                                                |
| `err(error)`   | The failure case. By convention `error` is an `Error` subclass with a literal `type` field, such as `FooNotFoundError` below, so callers switch on `type` and logs keep a stack. |

</details>

<details><summary><b>An error that carries its data</b></summary>

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
```

</details>

**Needs** nothing: no dependencies, peers or env.
