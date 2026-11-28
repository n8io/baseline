# @n8io/baseline-analytics

## 3.0.1

### Patch Changes

- 8a03afb: The `vendor` key check in `analyticsMixpanelCreate` now calls `sharedVendorKeyRefused` from `@n8io/baseline-shared`. Behaviour is unchanged: the same `TypeError` for a `vendor` key other than `host`.
- 126f764: The package's logger is now built on its first use, not when the module loads, so a bad `LOG_LEVEL` no longer throws at import. The same `TypeError` is thrown by the first call that needs the logger.
- 6b596a6: The package's default logger now comes from `@n8io/baseline-logger`'s `loggerDefaultCreate`. Behaviour is unchanged: the logger is built on its first use, and a bad `LOG_LEVEL` throws the same `TypeError` there.
- Updated dependencies [8a03afb]
- Updated dependencies [b3a3a95]
- Updated dependencies [6b596a6]
- Updated dependencies [39c8e87]
  - @n8io/baseline-shared@0.1.2
  - @n8io/baseline-logger@4.1.0

## 3.0.0

### Major Changes

- ad5e91a: `ErrorTrackingSentryVendorOptions`, `AnalyticsMixpanelVendorOptions`, `FeatureFlagsLaunchDarklyVendorOptions` and `FeatureFlagsLaunchDarklyClientVendorOptions` are no longer exported, so no public type names a Sentry, Mixpanel or LaunchDarkly type. The `vendor` option of `errorTrackingSentryCreate`, `analyticsMixpanelCreate`, `featureFlagsLaunchDarklyCreate` and `featureFlagsLaunchDarklyClientCreate` takes the same keys as before: write the object inline in the Project's wiring file (`src/error-tracking-open.ts`, `src/analytics-open.ts`, `src/feature-flags-open.ts`), or take `NonNullable<FeatureFlagsLaunchDarklyOptions<D, K>["vendor"]>` and its like. A test now fails when an exported signature of these Packages names a Sentry, LaunchDarkly, OpenFeature or Mixpanel type.

### Minor Changes

- 0202e13: `sharedTimeRace` and `sharedTimeLimit` now wait the full duration for a delay over 2147483647 ms (they fired after about 1 ms), and `sharedTimeTimer` is new. Shutdown clears its default timers when a run ends. `queueMigrate` still waits as long as pg-boss's index builds take; a new optional `indexesDeadlineMs` makes it throw after that many ms, and sets no limit by default. `analyticsLoggerCreate` takes a `logger` option.

### Patch Changes

- Updated dependencies [f89d502]
  - @n8io/baseline-logger@4.0.0

## 2.1.1

### Patch Changes

- d5953b6: The `vendor.host` message ends `found "<host>"`. README: the `analyticsMixpanelCreate` row names what it refuses, and `properties?` is marked optional.
- Updated dependencies [d5953b6]
- Updated dependencies [f0993b4]
  - @n8io/baseline-logger@3.1.3

## 2.1.0

### Minor Changes

- bfb7735: analytics follows the shared Package rules. `AnalyticsMixpanelOptions` is exported, and `vendor` and `vendor.host` take `null`, which means the default. `analyticsMixpanelCreate` now throws a `TypeError` on a `vendor` key other than `host`, which did nothing before (the type already refused it), and its messages start with `analyticsMixpanelCreate:`. Every export has a doc comment, and the README names `analyticsLoggerCreate` as the Package's stand-in.
- e7bc75a: `AnalyticsEvent.properties` takes `null` (same as leaving it out). `analyticsMixpanelCreate` throws `TypeError("analyticsMixpanelCreate: token must not be empty")`. Adds the `test:unit` script.

### Patch Changes

- 84c85e1: README and doc comment wording: examples show their imports, Exports rows name each export, and glossary words read as the glossary writes them.
- 9a5b1a1: Package metadata in one voice: every Package commits its own copy of the MIT `LICENSE` (the tarball already carried the root one), and its npm description is rewritten from its README in the glossary's words. `@n8io/baseline-live` drops its unused optional `redis` peer and `@n8io/baseline-authn` its unused optional `react` peer; neither imports them. The `client` entries of authn and live build with `platform: "neutral"`, as they run in browsers (the output is unchanged).
- Updated dependencies [e7bc75a]
- Updated dependencies [bfb7735]
- Updated dependencies [9a5b1a1]
  - @n8io/baseline-logger@3.1.2

## 2.0.1

### Patch Changes

- df8b85a: Rewrite the README: a bold promise, a Guarantees table, a short example, a testing note and the full reference folded below.
- Updated dependencies [df8b85a]
  - @n8io/baseline-logger@3.1.1

## 2.0.0

### Major Changes

- a61f217: Every handle that must be closed now has `[Symbol.asyncDispose]`, which calls its named close, so `await using` closes it however its block ends: `LiveHub` (`close`), `Queue` (`stop`), `HealthServer` (`close`), `Analytics` (`close`), `Pulsar` (`close`) and `PostgresPool` (`end`; the type is now pg's pool plus `AsyncDisposable`, and `postgresPoolCreate` adds the method to the pool it returns). The named methods stay.

  Breaking for code that builds one of these handles by hand, such as a test fake typed `LiveHub` or `Analytics`, or a raw `pg.Pool` passed where a `PostgresPool` is expected: add `[Symbol.asyncDispose]`, or build the pool with `postgresPoolCreate`.

  In the Template, `docs/agents/using.md` states the rule: use `using` for a resource that lives for one block (a test, a script step, a short helper); the shutdown package owns everything that lives as long as the process.

### Patch Changes

- Updated dependencies [3348934]
  - @n8io/baseline-logger@3.1.0

## 1.0.0

### Major Changes

- fedd96f: Add `@n8io/baseline-analytics`: analytics events sent to Mixpanel after commit, without blocking the request. The Template tracks `foo.created`, reads an optional `MIXPANEL_TOKEN` (without it, events go to the debug log and are not sent), and removes it all with `pnpm piece-remove analytics`.

### Minor Changes

- 867f91e: Vendor-only settings have one way in. `postgresPoolCreate`, `postgresMigrate`, `queueCreate`, `queueMigrate`, `pulsarCreate` and `analyticsMixpanelCreate` take a `vendor` option, typed as the vendor's own settings and passed through: `ssl` for Postgres, pg-boss's tuning, OAuth2 or mTLS for Pulsar, Mixpanel's `host` for data residency. A Package's named options win, and `vendor` throws on the keys they set and on the ones that would do nothing. `vendor` is outside each Package's contract: it is not tested, and a vendor swap deletes it.

  In the Template, `docs/agents/vendor-settings.md` says when to use it, and architecture rule A12 allows the vendor factories only in `src/connections.ts`, `src/redis.ts` and the `src/*-open.ts` files.

  A factory that is one vendor's takes one options object: `analyticsMixpanelCreate({ token, vendor? })`, `cacheStoreRedisCreate({ redisClient })` and `liveHubRedisCreate({ redisClient })` replace their positional forms. When you upgrade, wrap the argument of those three calls.

### Patch Changes

- Updated dependencies [d63058e]
  - @n8io/baseline-logger@3.0.0
