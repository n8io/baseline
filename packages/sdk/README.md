# @n8io/baseline-sdk

**Every SDK call has a deadline, and a read that fails for a moment is sent again.** `sdkFetchCreate` builds the fetch a Project's generated SDK calls: the caller picks an environment by name, not a URL, and gets a timeout on each attempt and on the whole call, retries only where sending twice is safe, and the same `{ status, data, headers }` it always resolved, in Node and in browsers.

```sh
pnpm add @n8io/baseline-sdk
```

<p align="center"><img src="https://raw.githubusercontent.com/n8io/baseline/main/docs/readme/sdk-retry.svg" width="880" alt="sdkFetch retries: a GET gets a 503 with Retry-After: 1, waits one second, is sent again and resolves its 200; a POST that gets a 503 is sent once and resolves the 503."></p>

## Guarantees

| You get                             | How                                                                                                                                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pick an environment, not a URL**  | The instance takes the Project's `environments` (name to API origin), and a caller names one: `environment: "production"`. A name that is not listed does not compile. There is no default: with no environment and no `baseUrl`, a call rejects and lists the names. |
| **No call that hangs**              | Each attempt has `timeoutMs` (10 s) until its response arrives, and the whole call, retries, waits and body included, has `totalTimeoutMs` (30 s). Either rejects with a `DOMException` named `TimeoutError`.                                                         |
| **Retries only where they're safe** | GET, HEAD and DELETE are sent again, `retry` times (2), after a network failure, a timed-out attempt, or a 408, 429, 500, 502, 503 or 504. POST and PATCH are sent once: a retry could apply them twice.                                                              |
| **The API's pace**                  | A `Retry-After` (seconds or a date), or a rate-limit reset header, sets the wait; otherwise it backs off from 0.3 s, doubling. When the wait would run past `totalTimeoutMs`, that response resolves at once instead.                                                 |
| **No throw on a status**            | Every response, the last one after retries, resolves `{ status, data, headers }`: `data` is the parsed JSON when the content type names json, the text otherwise, or `undefined` for no body. A call rejects only when no whole response came.                        |
| **One instance per SDK**            | `sdkFetchCreate` holds no module state, so two SDKs in one app keep their own environments, token and timeouts.                                                                                                                                                       |
| **Traced with no code**             | With `@n8io/baseline-telemetry` started, a call made inside a span carries `traceparent`; the SDK adds no header of its own (`src/sdk-traceparent.test.ts`).                                                                                                          |
| **Node and browsers**               | No `node:` import and no Node global in what ships (`src/sdk-isomorphic.test.ts`).                                                                                                                                                                                    |

## Example

```ts title="clients/sdk/sdk-fetch.ts"
import { type SdkOptions as Options, sdkFetchCreate } from "@n8io/baseline-sdk";
import environments from "../environments.json" with { type: "json" };

export type SdkOptions = Options<keyof typeof environments>;

const sdk = sdkFetchCreate({ environments });

export const sdkConfigure: (options: SdkOptions) => void = sdk.sdkConfigure;

// An arrow function, not sdk.sdkFetch itself: orval reads the mutator's parameters from its source.
export const sdkFetch = <T>(
	url: string,
	options: RequestInit & SdkOptions,
): Promise<T> => sdk.sdkFetch<T>(url, options);
```

This is the Template's file as it is. orval reads the mutator's source, not its type, and exits 0 when it cannot, so keep `sdkFetch` an arrow function with its parameters written out. `clients/environments.json` maps each environment's name to its API origin, such as `{ "development": "http://localhost:3000", "production": "https://api.example.com" }`.

```ts
sdkConfigure({ environment: "production", token });
await fooList({ limit: 10 });
// An Event handler is already retried by the queue, so it sends once:
await fooDelete(fooId, { retry: 0 });
```

Test it against a real local HTTP server (`node:http`) that answers each request in turn, sent there with the `baseUrl` override, and count the requests it saw (`src/sdk-fetch.test.ts`).

## Reference

<details><summary><b>Exports</b></summary>

| Export                                         | Does                                                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sdkFetchCreate({ defaults?, environments? })` | Builds one instance from its environments (name to API origin) and default `SdkOptions`, and returns `SdkFetch`. With no environments, only `baseUrl` sends a call. |
| `SdkFetch`                                     | `{ sdkConfigure, sdkFetch }`.                                                                                                                                       |
| `SdkFetchOptions`                              | `{ defaults?, environments? }`, what `sdkFetchCreate` takes.                                                                                                        |
| `sdkConfigure(options)`                        | Merges `SdkOptions` into what every later call of this instance uses.                                                                                               |
| `sdkFetch(url, options)`                       | The generated SDK's mutator: `url` is the operation's path and query; `options` is `RequestInit` plus `SdkOptions`, which override for one call.                    |
| `SdkOptions`                                   | `{ environment?, baseUrl?, token?, timeoutMs?, totalTimeoutMs?, retry? }`, below.                                                                                   |

</details>

<details><summary><b>Options</b></summary>

| Option           | Default | Means                                                                                                                                                                   |
| ---------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment`    |         | Which listed environment to call, such as `production`. The call's `baseUrl`, else its `environment`, else the configured `baseUrl`, else the configured `environment`. |
| `baseUrl`        |         | An API origin that overrides the environment: for tests, a worktree's own instance or a one-off server, not for picking production.                                     |
| `token`          |         | Sent as `authorization: Bearer <token>`.                                                                                                                                |
| `timeoutMs`      | 10000   | Milliseconds each attempt may wait for its response.                                                                                                                    |
| `totalTimeoutMs` | 30000   | Milliseconds the whole call may take, retries, waits and reading the body included.                                                                                     |
| `retry`          | 2       | How many times a GET, HEAD or DELETE is sent again. `0` sends once: use it where a caller already retries, such as an Event handler.                                    |

Every option may be `null`, which means the same as leaving it out: a call's `null` takes the configured value, and a configured `null` the default. A caller's own `signal` still cancels the call; it rejects with that signal's reason.

</details>

<details><summary><b>What rejects</b></summary>

- A timeout, of an attempt after the last retry or of the whole call: a `DOMException` named `TimeoutError`, as `AbortSignal.timeout` gives.
- A network failure after the last retry: the error `fetch` gave (a `TypeError`). A connection that drops while the body is read rejects at once, without a retry.
- A JSON content type with a body that is not JSON: the `SyntaxError` from parsing it.
- A `retry` that is not a whole number of 0 or more, or a `timeoutMs` or `totalTimeoutMs` that is not a positive integer: a `TypeError` whose message starts with the function and the option (`sdkFetchCreate: defaults.retry`, `sdkConfigure: timeoutMs`, `sdkFetch: totalTimeoutMs`). `sdkFetchCreate` and `sdkConfigure` throw it; `sdkFetch` rejects with it.
- No environment and no `baseUrl`: an `Error` that lists the environments and names `sdkConfigure`, or, from an instance that lists none, one that asks for a `baseUrl`. An environment that is not listed (a JavaScript caller the types do not stop): an `Error` that lists them.

</details>

**Needs** `fetch`, `AbortSignal.timeout` and `AbortSignal.any` (Node 26, current browsers). Runs on ky, which never appears in its types.
