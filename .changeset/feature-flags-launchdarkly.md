---
"@n8io/baseline-feature-flags": patch
---

The LaunchDarkly server adapter on `/launchdarkly`: `featureFlagsLaunchDarklyCreate` maps kinds to a multi-kind context, runs in its own OpenFeature domain, never blocks boot, and falls back with a logged reason.
