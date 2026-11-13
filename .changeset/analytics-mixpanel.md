---
"@n8io/baseline-analytics": major
"app": minor
---

Add `@n8io/baseline-analytics`: analytics events sent to Mixpanel after commit, without blocking the request. The Template tracks `foo.created`, reads an optional `MIXPANEL_TOKEN` (without it, events go to the debug log and are not sent), and removes it all with `pnpm piece-remove analytics`.
