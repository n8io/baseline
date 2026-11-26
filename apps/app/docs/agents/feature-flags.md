# Feature flags

Read when you add, read, test or remove a feature flag, or add a flag kind (`customer`, `worker`). The Package is `@n8io/baseline-feature-flags`; its README has the full API. Removing the piece is in [pieces.md](pieces.md#feature-flags).

## Rules

1. Import `@n8io/baseline-feature-flags` only. Never import LaunchDarkly or OpenFeature (lint A31).
2. Declare every flag in `src/flags.ts` with `featureFlagsDefine`, nowhere else (A32).
3. `key` is the flag service's key, written in `src/flags.ts` only (A33). Code reads a flag by its name: `get("exampleFlag")`.
4. `fallback` is the safe value when the service is down: off, closed, the old behaviour.
5. A string with a closed set takes `values`; an object takes `schema`. Never cast a flag's value (A34).
6. Server: `featureFlagsForActor({ actor, featureFlags: connections.featureFlags })` per request, then `await flags.get("x")`. Never keep a handle between requests or users.
7. Browser: `useFeatureFlag("x")` only; it is synchronous and re-renders when the flag changes.
8. A context is whole: a changed identity is `await contextSet(full context)`. Contexts replace, never merge.
9. Tests: `featureFlagsMemoryCreate` or `featureFlagsMemoryClientCreate` from `/testing`. Never mock the vendor.
10. Reads never throw and fall back to the declared value; the server logs `{ flag, key, reason }`, the browser logs nothing unless `onFallback` is passed. Do not wrap reads in try/catch.

## Add a flag

Add it to `flagDefs` in `src/flags.ts`, one tab deep as `name: { key: "...", fallback: ... }` (A34 reads the names from that shape), with a distinctive key. Create the flag with that key in LaunchDarkly: keys are the same in every environment.

## Add a kind (customer, worker)

1. Add it to `flagKinds` in `src/flags.ts`: `{ actor: "required", customer: "optional", worker: "optional" }`. Make required only a kind every context has. Widen the type annotation on `flagKinds` to match, or it does not compile.
2. Create a context kind of the same name in LaunchDarkly.
3. Pass it where it applies: `featureFlags.context({ actor: { id }, customer: { id: customerId } })`, or `featureFlags.context({ worker: { id: jobId } })` in a job. `featureFlagsForActor` builds an actor-only context; write a sibling for another shape.

## Browser and React

`src/ui/entry.client.tsx` awaits `featureFlagsBrowserStart({ page: document, tree })` (read the config script, open the client, wrap the app) before `hydrateRoot`, so the first client render has settled values. `LAUNCHDARKLY_CLIENT_SIDE_ID` is public and optional; without it, or without a signed-in Actor, no client is made and every flag reads its fallback. A Project that removes and restores the piece, or one created before it, adds four blocks by hand (the CSP one is described under Content Security Policy below), each inside `// piece-start: feature-flags` and `// piece-end: feature-flags`: in `src/server.ts` the `loadContext.set(featureFlagsClientSideIdContext, ENV.LAUNCHDARKLY_CLIENT_SIDE_ID || null)` call, in the `src/ui/root.tsx` loader `featureFlags: featureFlagsClientConfigGet({ actor, clientSideId })`, and in the `Layout` head `<FeatureFlagsConfigScript />`. The browser cannot read the loader's data before it hydrates (React Router builds its state during hydration), so `FeatureFlagsConfigScript` renders the config as a JSON `<script id="feature-flags-config">` in the HTML and `featureFlagsBrowserStart` reads that element from `document` (`featureFlagsClientConfigRead`). `entry.client.tsx` never reads `window.__reactRouterContext` (A35).

## Content Security Policy

The browser client reaches LaunchDarkly itself, so the CSP's `connect-src` must allow its origins or the browser blocks every request and each flag reads its fallback. `src/server.ts` passes `featureFlagsLaunchDarklyClientOrigins()` to `httpSecureHeadersCreate({ connectSrc })` in a `feature-flags` block, only when `LAUNCHDARKLY_CLIENT_SIDE_ID` is set. A Project that gives the browser client `vendor` options (a relay, or the EU or federal endpoints) passes the same `vendor` to `featureFlagsLaunchDarklyClientOrigins({ vendor })`. `test/integration/feature-flags-config.test.ts` checks the policy the real server sends.

## Telemetry

Each evaluation by the LaunchDarkly server adapter is a `feature_flag.evaluation` log record (no span event, no context recorded); see [tracing.md](tracing.md). The browser client records none yet, and there is no evaluation counter.

## Tests

Build the flags with `featureFlagsMemoryCreate({ flags: flagDefs, values: { exampleFlag: true } })`; values are typed per flag. `featureFlagsMemoryClientCreate` is the browser one, with `valuesSet` to push a change.
