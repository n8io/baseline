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

<details><summary><b>Exports</b></summary>

| Export                                                                                                                             | Does                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `featureFlagsDefine({ name: { key, fallback, values?, schema? } })`, `FeatureFlagDefinition`                                       | Declares the Project's flags. Returns them typed and frozen. Throws a `TypeError` for an empty or duplicate `key`, a reserved name, a fallback outside `values` or failing `schema`, `values` with `schema`, and an async `schema`. |
| `FlagValue<D>`                                                                                                                     | The type a flag reads as: `FlagValue<typeof flagDefs.heroCopy>`.                                                                                                                                                                    |
| `FeatureFlags`, `FeatureFlagsHandle`                                                                                               | The server's flags: `context({ actor, customer })` returns a handle whose `get(name)` is async. `ready`, `close()` and `await using` sit beside the flags.                                                                          |
| `FeatureFlagsClient`, `FeatureFlagsBrowser`                                                                                        | The browser's flags: `flags.get(name)` is synchronous, `flags.subscribe(name, listener)` fires only when that flag changed, and `contextSet(context)` replaces the whole context.                                                   |
| `FeatureFlagContext`, `FeatureFlagKinds`, `FeatureFlagContextEntry`                                                                | A context is `{ kind: { id, attributes? } }`. Kinds are declared `"required"` or `"optional"` where the adapter is created.                                                                                                         |
| `FeatureFlagFallback`, `FeatureFlagFallbackReason`, `FeatureFlagsReadyStatus`                                                      | What is reported when a read returns the fallback, and how `ready` settles.                                                                                                                                                         |
| `@n8io/baseline-feature-flags/testing`: `featureFlagsMemoryCreate({ flags, kinds?, values?, ready?, onFallback? })`                | The server flags in memory. `values` is typed per flag, or a function of the context.                                                                                                                                               |
| `@n8io/baseline-feature-flags/testing`: `featureFlagsMemoryClientCreate({ flags, kinds?, context, values?, ready?, onFallback? })` | The browser client in memory, with `valuesSet(values)` to push a change.                                                                                                                                                            |

</details>

**Needs**: `@standard-schema/spec` (types only). The adapters and the React layer ship on later subpaths with optional peers.
