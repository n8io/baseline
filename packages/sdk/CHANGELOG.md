# @n8io/baseline-sdk

## 2.0.1

### Patch Changes

- d5953b6: `SdkFetchOptions` takes its environment type argument with a `string` default, like `SdkOptions` and `SdkFetch`, and bad-option messages end `found X`. Test files are named after `sdk-fetch.ts`.

## 2.0.0

### Major Changes

- f216435: Options follow the shared Package rules. `timeout` and `totalTimeout` are now `timeoutMs` and `totalTimeoutMs` (still milliseconds), and the type `sdkFetchCreate` takes is `SdkFetchOptions`, not `SdkFetchCreateInput`; there are no aliases, so rename them where you pass or import them. Every `SdkOptions` field takes `null`, which means the same as leaving it out. A bad `retry` (not a whole number of 0 or more) or a `timeoutMs` or `totalTimeoutMs` that is not a positive integer of at most 2147483647 now throws a `TypeError` that starts with the function and the option, such as `sdkConfigure: timeoutMs`, instead of reaching the network. The README's `clients/sdk/sdk-fetch.ts` example is now the Template's file, which orval can read.

### Patch Changes

- 84c85e1: README and doc comment wording: examples show their imports, Exports rows name each export, and glossary words read as the glossary writes them.
- e7bc75a: Internal names and tests tidied; adds the `test:unit` script so root `pnpm test:unit` runs this Package's tests.
- 9a5b1a1: Package metadata in one voice: every Package commits its own copy of the MIT `LICENSE` (the tarball already carried the root one), and its npm description is rewritten from its README in the glossary's words. `@n8io/baseline-live` drops its unused optional `redis` peer and `@n8io/baseline-authn` its unused optional `react` peer; neither imports them. The `client` entries of authn and live build with `platform: "neutral"`, as they run in browsers (the output is unchanged).

## 1.0.0

### Major Changes

- 03d501e: Add `@n8io/baseline-sdk`: the fetch a Project's generated SDK calls, in Node and browsers. `sdkFetchCreate({ defaults?, environments? })` returns `{ sdkConfigure, sdkFetch }`, one instance per SDK, so two SDKs in one app keep their own environments and token. A caller picks an environment by name (`sdkConfigure({ environment: "production" })`, typed, so a misspelt name does not compile) instead of a URL; there is no default, and `baseUrl` stays as an override for tests, worktrees and one-off servers. Every call has a timeout per attempt (`timeout`, 10 s) and one for the whole call (`totalTimeout`, 30 s), and a GET, HEAD or DELETE is sent again (`retry`, 2; `0` turns it off) after a network failure, a timed-out attempt or a 408, 429, 500, 502, 503 or 504, waiting as `Retry-After` says. POST and PATCH are sent once. A call still never throws on an HTTP status: it resolves `{ status, data, headers }`, and rejects only with a `TimeoutError` DOMException, the error fetch gave, or an error when it has no environment or an unknown one to send to.
