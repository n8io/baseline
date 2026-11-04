---
"@n8io/baseline-authn": minor
"@n8io/baseline-cache": minor
"@n8io/baseline-health": minor
"@n8io/baseline-http": minor
"@n8io/baseline-id": minor
"@n8io/baseline-live": minor
"@n8io/baseline-logger": minor
"@n8io/baseline-postgres": minor
"@n8io/baseline-pulsar": minor
"@n8io/baseline-queue": minor
"@n8io/baseline-result": minor
"@n8io/baseline-shutdown": minor
"@n8io/baseline-telemetry": minor
"app": minor
---

The @n8io/baseline-* packages publish publicly to npmjs, so installs need no npm token. Projects drop the `@n8io:registry` line from `.npmrc`, and the image builds with no `packages_token` secret.
