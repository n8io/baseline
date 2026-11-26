---
"@n8io/baseline-analytics": major
"@n8io/baseline-error-tracking": major
"@n8io/baseline-feature-flags": major
---

`ErrorTrackingSentryVendorOptions`, `AnalyticsMixpanelVendorOptions`, `FeatureFlagsLaunchDarklyVendorOptions` and `FeatureFlagsLaunchDarklyClientVendorOptions` are no longer exported, so no public type names a Sentry, Mixpanel or LaunchDarkly type. The `vendor` option of `errorTrackingSentryCreate`, `analyticsMixpanelCreate`, `featureFlagsLaunchDarklyCreate` and `featureFlagsLaunchDarklyClientCreate` takes the same keys as before: write the object inline in the Project's wiring file (`src/error-tracking-open.ts`, `src/analytics-open.ts`, `src/feature-flags-open.ts`), or take `NonNullable<FeatureFlagsLaunchDarklyOptions<D, K>["vendor"]>` and its like. A test now fails when an exported signature of these Packages names a Sentry, LaunchDarkly, OpenFeature or Mixpanel type.
