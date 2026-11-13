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
