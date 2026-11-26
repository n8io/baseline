# @n8io/baseline-feature-flags

## 1.1.0

### Minor Changes

- 8745155: Tidy feature flags and secure headers.
  - http: remove the `httpSecureHeaders` constant. Use `httpSecureHeadersCreate()` (same headers, no extra origins).
  - feature-flags: drop the unused `@openfeature/core` peer and the `@n8io/baseline-telemetry` dependency (the evaluation log record now goes through `@opentelemetry/api`, an optional peer of the server adapter); add the `/launchdarkly/origins` entry so a server loads the CSP origins without the browser SDKs (`/launchdarkly/client` still re-exports it); throw a `TypeError` from both factories on an empty key or a `readyTimeoutMs` that is not a whole number of milliseconds from 1 to 2147483647 (0, negative and fractional values were accepted before, and now fail at boot); record evaluations under the instrumentation scope `@n8io/baseline-feature-flags` instead of `@n8io/baseline-telemetry`; export `FeatureFlagsFallbackOptions`, `FeatureFlagsOnFallback` and `FeatureFlagsLaunchDarklyClientVendorOptions`.
  - feature-flags, sdk, live, authn: add `sideEffects: false` so bundlers can tree-shake them.

### Patch Changes

- 64b75db: Share the helpers the Packages each wrote their own copy of, through the new `@n8io/baseline-shared`.
  - shared: new Package with the timeout race (`sharedTimeLimit`, `sharedTimeRace`), the integer option check (`sharedIntegerAssert`), the 2147483647 timer limit, the server keep-alive timeouts and the Postgres connection checks. It has no dependencies and is for the Packages, not for a Project.
  - redis, cache, live, feature-flags: use the one timeout race instead of six hand-written ones.
  - cache, feature-flags, health, queue, postgres, shutdown, sdk: option errors now come from one formatter, so a bad number reads `<function>: <option> must be a whole number from 1 to N, found X` (or `, N or more`); the same inputs still throw a `TypeError`.
  - health, http: one owner for the 65 s keep-alive; `httpServerKeepAlive` is unchanged.
  - queue, postgres: one copy of the Postgres URL and TLS checks.
  - sdk: ky does the waiting on `Retry-After` and rate-limit headers; the hand-written backoff and header parsing are gone. A wait that runs past `totalTimeoutMs` now ends in the `TimeoutError` instead of resolving the 429 or 503 at once.
- Updated dependencies [64b75db]
  - @n8io/baseline-shared@0.1.0

## 1.0.0

### Major Changes

- 0656a01: New Package: declare feature flags once with `featureFlagsDefine`, read them typed with a safe fallback, and test with in-memory flags from `/testing`.

### Minor Changes

- c470b6a: `featureFlagsLaunchDarklyClientOrigins({ vendor? })` from `/launchdarkly/client` returns the origins the browser client reaches (LaunchDarkly's own, or those of `vendor.baseUri`, `vendor.streamUri` and `vendor.eventsUri`), for the page's CSP `connect-src`. Without them the browser blocks every LaunchDarkly request and each flag reads as its fallback.
- 35a01d4: The server's LaunchDarkly flags now record every read as the OpenTelemetry `feature_flag.evaluation` log record (key, provider name, reason, variant or a small value, `error.type` on a fallback), found by the request's trace and never carrying a context. A flag service outage is logged once when it starts and once when reads recover, not on every read. `@n8io/baseline-telemetry/feature-flag` is the new entry that records it.
- f5a3df9: The React layer on `/react`: `featureFlagsReactCreate(flagDefs)` returns a typed `FeatureFlagsProvider` and `useFeatureFlag`. The hook re-renders only for its own flag, keeps object flags referentially stable, and returns the declared fallback on the server.

### Patch Changes

- 9e9a446: README: declaring flags, the server, browser and React, shutdown, extending kinds (`customer`, `worker`), errors and fallbacks, and the OpenTelemetry evaluation record.
- 83199aa: The server and browser flags: reads never throw and fall back with a logged reason, `ready` never rejects, browser snapshots are stable and notify only the flags that changed, and in-memory flags for tests from `/testing`.
- d39806b: `featureFlagsFallbackCreate`: the server's flags with no flag service, answering every read with the flag's declared fallback, for a Project that has not set up a vendor.
- c1e2bdb: The LaunchDarkly browser adapter on `/launchdarkly/client`: `featureFlagsLaunchDarklyClientCreate` opens the browser's flags with live updates, a ready status that never rejects, and one OpenFeature domain per client.
- 8629dd4: The LaunchDarkly server adapter on `/launchdarkly`: `featureFlagsLaunchDarklyCreate` maps kinds to a multi-kind context, runs in its own OpenFeature domain, never blocks boot, and falls back with a logged reason.
- Updated dependencies [35a01d4]
  - @n8io/baseline-telemetry@2.1.0
