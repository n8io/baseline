# @n8io/baseline-shared

**The small helpers the other Baseline Packages share**, so each is written once: a timeout race, an integer option check, the server keep-alive timeouts and the Postgres connection checks. It is for the Packages, not for a Project to call.

```sh
pnpm add @n8io/baseline-shared
```

## Guarantees

| You get                       | How                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **One timeout race**          | `sharedTimeLimit` rejects with a `TimeoutError`; `sharedTimeRace` resolves a value instead. Both clear their timer when the work wins. |
| **One option error**          | `sharedIntegerAssert` throws a `TypeError` that names the function, the option and the value found.                                    |
| **No secrets in errors**      | The connection checks name the scheme or the option, never the URL, which may hold a password.                                         |
| **Runs in Node and browsers** | No `node:` import and no dependencies.                                                                                                 |

## Example

```ts
import { sharedTimeLimit } from "@n8io/baseline-shared";

await sharedTimeLimit({
	message: "Redis did not answer within 1000 ms",
	ms: 1000,
	work: redisClient.get("key"),
});
```

## Reference

<details><summary><b>Exports</b></summary>

| Export                                                       | Does                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `sharedTimeLimit({ message, ms, work })`                     | Settles like `work`, or rejects with a `DOMException` named `TimeoutError` once `ms` passes first.                                         |
| `sharedTimeRace({ ms, value, work })`                        | Settles like `work`, or resolves `value` once `ms` passes first, however long `ms` is.                                                     |
| `sharedTimeTimer({ ms, value, ref? })`, `SharedTimeTimer`    | Resolves `value` after `ms`, however long: a wait over the cap runs as several timers. `clear()` stops it. `unref`ed unless `ref` is true. |
| `sharedTimerMaxMs`                                           | 2147483647, the longest wait a timer takes.                                                                                                |
| `sharedIntegerAssert({ caller, max, min, name, value })`     | Throws a `TypeError` unless `value` is a whole number from `min` to `max`.                                                                 |
| `sharedKeepAlive(server)`                                    | Sets a server's keep-alive timeout to 65 s and its headers timeout above it.                                                               |
| `sharedConnectionUrlAssert(databaseUrl, caller)`             | Throws unless the URL starts with `postgres://` or `postgresql://`.                                                                        |
| `sharedConnectionSslAssert({ caller, databaseUrl, vendor })` | Throws on `vendor.ssl` beside an `ssl*` URL parameter, or on a URL that does not parse.                                                    |

</details>

**Needs** nothing: no peers and no env.
