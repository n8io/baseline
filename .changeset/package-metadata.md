---
"@n8io/baseline-analytics": patch
"@n8io/baseline-authn": patch
"@n8io/baseline-cache": patch
"@n8io/baseline-cli": patch
"@n8io/baseline-error-tracking": patch
"@n8io/baseline-health": patch
"@n8io/baseline-http": patch
"@n8io/baseline-id": patch
"@n8io/baseline-live": patch
"@n8io/baseline-logger": patch
"@n8io/baseline-postgres": patch
"@n8io/baseline-queue": patch
"@n8io/baseline-redis": patch
"@n8io/baseline-result": patch
"@n8io/baseline-sdk": patch
"@n8io/baseline-shutdown": patch
"@n8io/baseline-telemetry": patch
---

Package metadata in one voice: every Package commits its own copy of the MIT `LICENSE` (the tarball already carried the root one), and its npm description is rewritten from its README in the glossary's words. `@n8io/baseline-live` drops its unused optional `redis` peer and `@n8io/baseline-authn` its unused optional `react` peer; neither imports them. The `client` entries of authn and live build with `platform: "neutral"`, as they run in browsers (the output is unchanged).
