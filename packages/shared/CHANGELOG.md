# @n8io/baseline-shared

## 0.1.2

### Patch Changes

- 8a03afb: Adds `sharedVendorKeyRefused({ allowed, vendor })`, the one check that a `vendor` object holds only the keys a Package allows. It returns the first refused key, so each caller keeps its own error message and names no vendor.

## 0.1.1

### Patch Changes

- 0202e13: `sharedTimeRace` and `sharedTimeLimit` now wait the full duration for a delay over 2147483647 ms (they fired after about 1 ms), and `sharedTimeTimer` is new. Shutdown clears its default timers when a run ends. `queueMigrate` still waits as long as pg-boss's index builds take; a new optional `indexesDeadlineMs` makes it throw after that many ms, and sets no limit by default. `analyticsLoggerCreate` takes a `logger` option.

## 0.1.0

### Minor Changes

- 64b75db: Share the helpers the Packages each wrote their own copy of, through the new `@n8io/baseline-shared`.
  - shared: new Package with the timeout race (`sharedTimeLimit`, `sharedTimeRace`), the integer option check (`sharedIntegerAssert`), the 2147483647 timer limit, the server keep-alive timeouts and the Postgres connection checks. It has no dependencies and is for the Packages, not for a Project.
  - redis, cache, live, feature-flags: use the one timeout race instead of six hand-written ones.
  - cache, feature-flags, health, queue, postgres, shutdown, sdk: option errors now come from one formatter, so a bad number reads `<function>: <option> must be a whole number from 1 to N, found X` (or `, N or more`); the same inputs still throw a `TypeError`.
  - health, http: one owner for the 65 s keep-alive; `httpServerKeepAlive` is unchanged.
  - queue, postgres: one copy of the Postgres URL and TLS checks.
  - sdk: ky does the waiting on `Retry-After` and rate-limit headers; the hand-written backoff and header parsing are gone. A wait that runs past `totalTimeoutMs` now ends in the `TimeoutError` instead of resolving the 429 or 503 at once.
