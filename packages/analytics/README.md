# @n8io/baseline-analytics

**Analytics events that can never slow or fail a request**: what an Actor did, sent to product analytics after the change commits, for funnels and retention.

```sh
pnpm add @n8io/baseline-analytics
```

## Guarantees

| You get                         | How                                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fire and forget**             | `track` returns at once and never throws: a failed send is logged at warn and dropped.                                                                                             |
| **Bounded shutdown**            | Each send times out after 5 s, so `close()`, which waits for the sends in flight, is bounded too. `await using` calls it.                                                          |
| **Ids and counts only**         | The contract for `properties`: ids and counts, never a Model, an input or personal data.                                                                                           |
| **No location guessed**         | Geolocation is off: the server's IP is not the Actor's.                                                                                                                            |
| **Malformed events are loud**   | Ingestion runs in strict mode, so a malformed event is refused and logged instead of dropped silently.                                                                             |
| **Data residency**              | `vendor.host` picks the ingestion host; anything but a bare host name throws, so the token cannot go to a URL with a path or scheme of its own. Any other `vendor` key throws too. |
| **Works with no account**       | `analyticsLoggerCreate()` logs each event at debug instead, for development and tests.                                                                                             |
| **Swap the vendor in one line** | `Analytics` and `AnalyticsEvent` name no vendor: a new `analytics<Vendor>Create` adapter here and one line in the Project; callers do not change.                                  |

## Example

```ts
import {
	analyticsLoggerCreate,
	analyticsMixpanelCreate,
} from "@n8io/baseline-analytics";

const analytics = ENV.MIXPANEL_TOKEN
	? analyticsMixpanelCreate({ token: ENV.MIXPANEL_TOKEN })
	: analyticsLoggerCreate();

analytics.track({
	actorId: actor.id,
	name: "foo.created",
	properties: { fooId: foo.id },
});
```

Call `track` after the change commits, and `await analytics.close()` at shutdown.

Tests pass `analyticsLoggerCreate()`, the Package's stand-in with no account (a logger fallback, not a memory adapter), or an `Analytics` (`track`, `close` and `Symbol.asyncDispose`) that records what it was handed.

## Reference

<details><summary><b>Exports</b></summary>

| Export                                                                    | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Analytics`                                                               | `track({ name, actorId, properties? })` and `close()`. `track` never throws: a failed send is logged at warn and dropped. `await using` calls `close()` when its block ends.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `AnalyticsEvent`                                                          | `name` (`foo.created`), `actorId` and `properties` (`boolean`, `number` or `string` values), which carry ids and counts only, never a Model, an input or personal data.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `analyticsMixpanelCreate({ token, vendor? })`, `AnalyticsMixpanelOptions` | Posts each event to Mixpanel's ingestion API (`/track`) with `fetch`, with geolocation off and a 5 s timeout per send, so `close()` is bounded too. `vendor.host` picks the ingestion host for data residency (`api-eu.mixpanel.com`, `api-in.mixpanel.com`), outside the contract; its type is not exported, so write the object inline in the Project's wiring file. An empty `token` throws a `TypeError`, as does a `vendor` key other than `host` or a `vendor.host` that is not a bare host name. It does not use the `mixpanel` Node SDK: 0.24 throws on `init` whenever `HTTPS_PROXY` is set and sets no request timeout. |
| `analyticsLoggerCreate({ logger? })`, `AnalyticsLoggerOptions`            | Logs each event at debug instead, for development and tests. `logger` is anything with a `debug` method (default the Package logger; `null` means the default), so a test passes a plain writer and reads back what it was given.                                                                                                                                                                                                                                                                                                                                                                                                 |

</details>

<details><summary><b>In the Template</b></summary>

`src/analytics-open.ts` picks the adapter as in the Example and, with a token, adds a shutdown step named `analytics`. `MIXPANEL_TOKEN` is optional: without it, events go to the debug log and are not sent. `pnpm piece-remove analytics` deletes the piece.

</details>

<details><summary><b>Moving to the mixpanel SDK</b></summary>

`analyticsMixpanelCreate` uses `fetch` only because `mixpanel` 0.19.1 to 0.24.0 throw `HttpsProxyAgent is not a constructor` on `init` whenever `HTTPS_PROXY` is set ([mixpanel-node#252](https://github.com/mixpanel/mixpanel-node/issues/252)). Once a release fixes that:

1. `pnpm add mixpanel` in `packages/analytics`.
2. In `src/analytics-mixpanel.ts`, replace the `fetch` call with `Mixpanel.init(token, { ...vendor, geolocate: false }).track(name, { ...properties, distinct_id: actorId }, callback)`. Wrap the call in try/catch, because the SDK throws on some properties, and keep each send bounded, because the SDK sets no request timeout.
3. Update `src/analytics-mixpanel.test.ts` to stand in for the SDK instead of `fetch`.

Nothing else changes: `Analytics` and `analyticsMixpanelCreate({ token, vendor })` keep their shape, and `vendor` widens to the SDK's init config, so Projects and the Template need no edits, and the change is a minor release.

</details>

**Needs** a project token (the Template reads `MIXPANEL_TOKEN`). Runs on Mixpanel.
