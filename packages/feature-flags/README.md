# @n8io/baseline-feature-flags

**Declare each feature flag once, read it with the type you declared, and get a safe fallback whenever the flag service is slow, down or wrong**, so a flag outage never fails a request or a page.

```sh
pnpm add @n8io/baseline-feature-flags
```

## Guarantees

| You get                        | How                                                                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One declaration**            | `featureFlagsDefine` holds every flag's key, fallback and type in one file. Code reads a flag by its camelCase name, and a typo does not compile.                     |
| **Typed reads**                | `false` reads as `boolean`, `10` as `number`, `values` as a union, and `schema` (any Standard Schema) as its output.                                                  |
| **Bad definitions fail early** | An empty or duplicate key, a reserved name, a fallback outside `values` or failing its schema, and an async schema throw when the module loads.                       |
| **A read never throws**        | A wrong type, a value outside `values`, a failing schema, a missing flag, an outage and a closed instance all return the fallback and report `{ flag, key, reason }`. |
| **Never blocks boot**          | `ready` settles `connected`, `failed` or `timeout` and never rejects. Until it is `connected`, reads return fallbacks.                                                |
| **One whole context**          | A context holds one entry per kind (`actor`, `customer`, `worker`). It is replaced whole and never merged or stacked; a required kind left out does not compile.      |
| **Vendor-neutral**             | No public type names a flag service. A vendor is an adapter on its own subpath with optional peers, so a Project that does not use it never installs its SDK.         |

## Example

```ts
import { featureFlagsDefine } from "@n8io/baseline-feature-flags";
import { featureFlagsMemoryCreate } from "@n8io/baseline-feature-flags/testing";

const flags = featureFlagsDefine({
	heroCopy: { key: "hero-copy", fallback: "plain", values: ["plain", "bold"] },
});
const values = { heroCopy: "bold" } as const;
await using featureFlags = featureFlagsMemoryCreate({ flags, values });
await featureFlags.ready;
await featureFlags.context({}).get("heroCopy"); // "bold"
```

The memory flags are the test stand-in: same types and fallback rules, values by flag name, no network. `featureFlagsMemoryClientCreate` is the browser one, with `subscribe`, `contextSet` and `valuesSet`.

## Reference

<details><summary><b>Declare the flags</b></summary>

Declare every flag once, in one file (the Template's is `src/flags.ts`). The property name is how code reads the flag; `key` is its key in the flag service, the same in every environment, written here and nowhere else.

```ts
import {
	type FlagValue,
	featureFlagsDefine,
} from "@n8io/baseline-feature-flags";

export const flagDefs = featureFlagsDefine({
	checkoutRedesign: { key: "checkout-redesign", fallback: false },
	maxExports: { key: "max-exports", fallback: 10 },
	heroCopy: { key: "hero-copy", fallback: "plain", values: ["plain", "bold"] },
	banner: { key: "banner", fallback: { text: "" }, schema: bannerSchema }, // any Standard Schema
});
export type HeroCopy = FlagValue<typeof flagDefs.heroCopy>; // "plain" | "bold"
```

Choose the fallback as the safe value when the flag service is down: off, closed, the old behaviour. A string with a closed set of answers takes `values`; an object takes `schema`. Never cast a flag's value.

</details>

<details><summary><b>Server</b></summary>

Open one instance per process with the adapter, then make a handle for each request. A handle holds one complete context and reads every flag for it.

```ts
import { featureFlagsLaunchDarklyCreate } from "@n8io/baseline-feature-flags/launchdarkly";

const featureFlags = featureFlagsLaunchDarklyCreate({
	flags: flagDefs,
	kinds: { actor: "required", customer: "optional" },
	sdkKey: ENV.LAUNCHDARKLY_SDK_KEY,
});
const flags = featureFlags.context({
	actor: { id: user.id },
	customer: { id: customerId },
});
const redesign = await flags.get("checkoutRedesign"); // boolean
```

Build the handle per request and drop it; never keep a context between requests or users. The server's `get` is asynchronous. `vendor` passes LaunchDarkly's own SDK options (`baseUri`, `proxyOptions`) through, and `readyTimeoutMs` (default 2000) bounds `ready`. Without an SDK key, `featureFlagsFallbackCreate({ flags, kinds })` answers every read with the declared fallback.

</details>

<details><summary><b>Shutdown</b></summary>

LaunchDarkly keeps a stream open and buffers events, so close the instance when the process stops. `close()` closes only this instance, never OpenFeature's global, and is safe to call twice; `await using` calls it too. The Template registers it as a shutdown step:

```ts
shutdownStepAdd({
	at: "last",
	group: "resources",
	step: { name: "feature flags", close: () => featureFlags.close() },
	steps,
});
```

</details>

<details><summary><b>Browser (no React)</b></summary>

The browser client holds one context, reads synchronously from a snapshot, and receives changes as the flag service pushes them. The adapter always turns LaunchDarkly's streaming on.

```ts
import { featureFlagsLaunchDarklyClientCreate } from "@n8io/baseline-feature-flags/launchdarkly/client";

const { flags, ready, contextSet } = featureFlagsLaunchDarklyClientCreate({
	clientSideId: config.clientSideId, // public by design
	context: { actor: { id: user.id } },
	flags: flagDefs,
	kinds: { actor: "required", customer: "optional" },
});
await ready; // "connected", "failed" or "timeout" (2 s); never rejects
flags.get("checkoutRedesign"); // boolean, synchronous
const stop = flags.subscribe("checkoutRedesign", render); // only when this flag changed
await contextSet({ actor: { id: user.id }, customer: { id: customerId } }); // replaces the whole context
```

An object flag returns the same reference until its content changes. To show two contexts at once, create a second client. The browser client records no OpenTelemetry (see Errors, fallbacks and telemetry).

</details>

<details><summary><b>React</b></summary>

`@n8io/baseline-feature-flags/react` has an optional peer on React. Make the Provider and hook once, typed from the declarations; the argument is only for its types.

```tsx
export const { FeatureFlagsProvider, useFeatureFlag } =
	featureFlagsReactCreate(flagDefs);

<FeatureFlagsProvider flags={flags} ready={ready}>
	<App />
</FeatureFlagsProvider>;

const redesign = useFeatureFlag("checkoutRedesign"); // boolean
```

`ready` is the awaited status (or a promise that keeps its identity); the children render once it settles, never forever, and `fallback` shows meanwhile. A server render and a hook outside a Provider return the declared fallbacks, so hydration never mismatches. When the app server-renders, `await ready` before `hydrateRoot` so the first client render has the live values.

</details>

<details><summary><b>Extending kinds: customer, worker</b></summary>

A kind is one type of thing a flag can target. The Template declares `actor`; adding another takes three steps, and the compiler finds every call that needs it.

1. Add it to `kinds` where the adapter is created: `kinds: { actor: "required", customer: "optional", worker: "optional" }`.
2. In the flag service, create a context kind with the same name (LaunchDarkly: Contexts, Context kinds, create `customer`).
3. Pass it in the context where it applies: `featureFlags.context({ actor, customer: { id: customerId } })`, or `featureFlags.context({ worker: { id: jobId } })` in a background job.

A `"required"` kind left out of a context does not compile; an `"optional"` one may be. Make required only the kinds every context has: a job with no user needs `actor` to be optional. Add the same `kinds` to the browser client, and pass the whole context to `contextSet` when it changes.

</details>

<details><summary><b>Errors, fallbacks and telemetry</b></summary>

`featureFlagsDefine` throws a `TypeError` when the module loads for a bad definition. After that nothing throws: `create` never throws, `get` never throws, and `ready` never rejects. Every fallback is reported as `{ flag, key, reason }`, with `reason` one of `closed`, `notFound`, `notInValues`, `notReady`, `schemaFailed`, `vendorError`, `wrongType`; the server adapter logs it at warn, and the browser adapter reports it only through the optional `onFallback` (the Template passes none, so browser fallbacks are silent). On the server a missing flag is reported once per flag, an outage once when it starts (with an info line when the service answers again), and `closed` and `notReady` are silent.

Each evaluation by the LaunchDarkly server adapter is recorded as the `feature_flag.evaluation` OpenTelemetry log record (the feature-flag conventions, Release Candidate) through `@n8io/baseline-telemetry/feature-flag` (the fallback and memory flags record nothing): the flag's key, provider name, reason, the variant (or a boolean or number value) and `error.type`. It carries the active trace, adds nothing to the span, and never records the context, which may be personal data. The browser client records no OpenTelemetry yet, and there is no evaluation counter, because the conventions define no metric.

</details>

<details><summary><b>Exports</b></summary>

| Export                                                                                                                                                                                                                      | Does                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `featureFlagsDefine({ name: { key, fallback, values?, schema? } })`, `FeatureFlagDefinition`                                                                                                                                | Declares the Project's flags. Returns them typed and frozen. Throws a `TypeError` for an empty or duplicate `key`, a reserved name, a fallback outside `values` or failing `schema`, `values` with `schema`, and an async `schema`. |
| `FlagValue<D>`                                                                                                                                                                                                              | The type a flag reads as: `FlagValue<typeof flagDefs.heroCopy>`.                                                                                                                                                                    |
| `FeatureFlags`, `FeatureFlagsHandle`                                                                                                                                                                                        | The server's flags: `context({ actor, customer })` returns a handle whose `get(name)` is async. `ready`, `close()` and `await using` sit beside the flags.                                                                          |
| `FeatureFlagsClient`, `FeatureFlagsBrowser`                                                                                                                                                                                 | The browser's flags: `flags.get(name)` is synchronous, `flags.subscribe(name, listener)` fires only when that flag changed, and `contextSet(context)` replaces the whole context.                                                   |
| `FeatureFlagContext`, `FeatureFlagKinds`, `FeatureFlagContextEntry`                                                                                                                                                         | A context is `{ kind: { id, attributes? } }`. Kinds are declared `"required"` or `"optional"` where the adapter is created.                                                                                                         |
| `FeatureFlagFallback`, `FeatureFlagFallbackReason`, `FeatureFlagsReadyStatus`                                                                                                                                               | What is reported when a read returns the fallback, and how `ready` settles.                                                                                                                                                         |
| `featureFlagsFallbackCreate({ flags, kinds? })`                                                                                                                                                                             | Server flags that answer every read with the declared fallback, for a Project with no flag service key.                                                                                                                             |
| `@n8io/baseline-feature-flags/launchdarkly`: `featureFlagsLaunchDarklyCreate({ flags, kinds?, sdkKey, vendor?, onFallback?, readyTimeoutMs? })`, `FeatureFlagsLaunchDarklyOptions`, `FeatureFlagsLaunchDarklyVendorOptions` | The server flags on LaunchDarkly. `vendor` passes its SDK options through.                                                                                                                                                          |
| `@n8io/baseline-feature-flags/launchdarkly/client`: `featureFlagsLaunchDarklyClientCreate({ clientSideId, context, flags, kinds?, onFallback?, readyTimeoutMs?, vendor? })`, `FeatureFlagsLaunchDarklyClientOptions`        | The browser client on LaunchDarkly; returns `{ flags, ready, contextSet, close }`. Streaming is always on.                                                                                                                          |
| `@n8io/baseline-feature-flags/react`: `featureFlagsReactCreate(flagDefs)`, `FeatureFlagsReact`, `FeatureFlagsProviderProps`                                                                                                 | Returns `{ FeatureFlagsProvider, useFeatureFlag }`, typed from the declarations.                                                                                                                                                    |
| `@n8io/baseline-feature-flags/testing`: `featureFlagsMemoryCreate({ flags, kinds?, values?, ready?, onFallback? })`                                                                                                         | The server flags in memory. `values` is typed per flag, or a function of the context.                                                                                                                                               |
| `@n8io/baseline-feature-flags/testing`: `featureFlagsMemoryClientCreate({ flags, kinds?, context, values?, ready?, onFallback? })`                                                                                          | The browser client in memory, with `valuesSet(values)` to push a change.                                                                                                                                                            |

</details>

**Needs**: `@standard-schema/spec` (types only). Each adapter has optional peers, so a Project that does not use it never installs them: `@launchdarkly/node-server-sdk`, `@launchdarkly/openfeature-node-server` and `@openfeature/server-sdk` for the server adapter; `@launchdarkly/js-client-sdk`, `@openfeature/core`, `@openfeature/launchdarkly-client-provider` and `@openfeature/web-sdk` for the browser adapter; `react` for `/react`. Runs on LaunchDarkly, through OpenFeature.
