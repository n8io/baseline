# @n8io/baseline-error-tracking

## 2.0.1

### Patch Changes

- 8a03afb: The `vendor` key check in `errorTrackingSentryCreate` now calls `sharedVendorKeyRefused` from `@n8io/baseline-shared`. Behaviour is unchanged: the same `TypeError` for a `vendor` key other than `release`, `dist` and `sampleRate`.
- 126f764: The package's logger is now built on its first use, not when the module loads, so a bad `LOG_LEVEL` no longer throws at import. The same `TypeError` is thrown by the first call that needs the logger.
- 6b596a6: The package's default logger now comes from `@n8io/baseline-logger`'s `loggerDefaultCreate`. Behaviour is unchanged: the logger is built on its first use, and a bad `LOG_LEVEL` throws the same `TypeError` there.
- Updated dependencies [8a03afb]
- Updated dependencies [b3a3a95]
- Updated dependencies [6b596a6]
- Updated dependencies [39c8e87]
  - @n8io/baseline-shared@0.1.2
  - @n8io/baseline-logger@4.1.0

## 2.0.0

### Major Changes

- ad5e91a: `ErrorTrackingSentryVendorOptions`, `AnalyticsMixpanelVendorOptions`, `FeatureFlagsLaunchDarklyVendorOptions` and `FeatureFlagsLaunchDarklyClientVendorOptions` are no longer exported, so no public type names a Sentry, Mixpanel or LaunchDarkly type. The `vendor` option of `errorTrackingSentryCreate`, `analyticsMixpanelCreate`, `featureFlagsLaunchDarklyCreate` and `featureFlagsLaunchDarklyClientCreate` takes the same keys as before: write the object inline in the Project's wiring file (`src/error-tracking-open.ts`, `src/analytics-open.ts`, `src/feature-flags-open.ts`), or take `NonNullable<FeatureFlagsLaunchDarklyOptions<D, K>["vendor"]>` and its like. A test now fails when an exported signature of these Packages names a Sentry, LaunchDarkly, OpenFeature or Mixpanel type.

### Minor Changes

- c38b1ad: `shutdownHandleCreate` takes `host.logger` and `errorTrackingSentryCreate` takes `logger`, each defaulting to the Package logger, so a test passes a plain object instead of reassigning a method of the logger.

### Patch Changes

- Updated dependencies [f89d502]
  - @n8io/baseline-logger@4.0.0

## 1.1.1

### Patch Changes

- d5953b6: README folds are tidied.
- Updated dependencies [d5953b6]
- Updated dependencies [f0993b4]
  - @n8io/baseline-logger@3.1.3

## 1.1.0

### Minor Changes

- bfb7735: error-tracking follows the shared Package rules. `vendor` takes `null`, which means the default. `errorTrackingSentryCreate`'s `TypeError` messages start with `errorTrackingSentryCreate:`. Every export has a doc comment, and the README example guards an unset `SENTRY_DSN` and tells a Project how to test code that reports, with no stubs.

### Patch Changes

- e7bc75a: Internal names and tests tidied; adds the `test:unit` script so root `pnpm test:unit` runs this Package's tests.
- 9a5b1a1: Package metadata in one voice: every Package commits its own copy of the MIT `LICENSE` (the tarball already carried the root one), and its npm description is rewritten from its README in the glossary's words. `@n8io/baseline-live` drops its unused optional `redis` peer and `@n8io/baseline-authn` its unused optional `react` peer; neither imports them. The `client` entries of authn and live build with `platform: "neutral"`, as they run in browsers (the output is unchanged).
- Updated dependencies [e7bc75a]
- Updated dependencies [bfb7735]
- Updated dependencies [9a5b1a1]
  - @n8io/baseline-logger@3.1.2

## 1.0.1

### Patch Changes

- df8b85a: Rewrite the README: a bold promise, a Guarantees table, a short example, an animated diagram, a testing note and the full reference folded below.
- Updated dependencies [df8b85a]
  - @n8io/baseline-logger@3.1.1

## 1.0.0

### Major Changes

- 3348934: Add `@n8io/baseline-error-tracking`: Error reports sent to Sentry (through `@sentry/core`) with their class name, stack, cause chain, error code and trace id, never their message. `@n8io/baseline-logger` gains `loggerErrorListen`, which hears every error logged at error or fatal, so the Template reports HTTP 500s, failed jobs and crashes without changing a caller. The Template reads an optional `SENTRY_DSN` (without it, errors are only logged) and removes it all with `pnpm piece-remove error-tracking`.

### Patch Changes

- Updated dependencies [3348934]
  - @n8io/baseline-logger@3.1.0
