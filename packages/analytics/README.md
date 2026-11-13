# @n8io/baseline-analytics

Analytics events: what an Actor did, sent to Mixpanel for funnels and retention. `track` returns at once, so a slow or failing Mixpanel never slows or fails a request; `close()` waits for the sends in flight.

```sh
pnpm add @n8io/baseline-analytics
```

## Exports

- `Analytics`: `track({ name, distinctId, properties })` and `close()`. `track` never throws: a failed send is logged at warn and dropped.
- `AnalyticsEvent`: `name` (`foo.created`), `distinctId` (the Actor's id) and `properties`, which carry ids and counts only, never a Model, an input or personal data.
- `analyticsMixpanelCreate(token)`: posts each event to Mixpanel's ingestion API (`/track`) with `fetch`, with geolocation off and a 5 s timeout per send, so `close()` is bounded too. It does not use the `mixpanel` Node SDK: 0.24 throws on `init` whenever `HTTPS_PROXY` is set and sets no request timeout.
- `analyticsLoggerCreate()`: logs each event at debug instead, for development and tests.

## Example

```ts
import {
	analyticsLoggerCreate,
	analyticsMixpanelCreate,
} from "@n8io/baseline-analytics";

const analytics = ENV.MIXPANEL_TOKEN
	? analyticsMixpanelCreate(ENV.MIXPANEL_TOKEN)
	: analyticsLoggerCreate();

// After the change commits:
analytics.track({
	distinctId: actor.id,
	name: "foo.created",
	properties: { fooId: foo.id },
});

// At shutdown:
await analytics.close();
```

## Needs

- A Mixpanel project token. The Template reads it from `MIXPANEL_TOKEN`, which is optional: without it, events go to the debug log and are not sent.

## Moving to the mixpanel SDK

`analyticsMixpanelCreate` uses `fetch` only because `mixpanel` 0.19.1 to 0.24.0 throw `HttpsProxyAgent is not a constructor` on `init` whenever `HTTPS_PROXY` is set ([mixpanel-node#252](https://github.com/mixpanel/mixpanel-node/issues/252)). Once a release fixes that:

1. `pnpm add mixpanel` in `packages/analytics`.
2. In `src/analytics-mixpanel.ts`, replace the `fetch` call with `Mixpanel.init(token).track(name, { ...properties, distinct_id: distinctId }, callback)`. Wrap the call in try/catch, because the SDK throws on some properties, and keep each send bounded, because the SDK sets no request timeout.
3. Update `src/analytics-mixpanel.test.ts` to stand in for the SDK instead of `fetch`.

Nothing else changes: `Analytics` and `analyticsMixpanelCreate(token)` keep their shape, so Projects and the Template need no edits, and the change is a patch release.
