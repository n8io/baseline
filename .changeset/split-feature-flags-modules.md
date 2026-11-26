---
"@n8io/baseline-feature-flags": patch
---

Split the oversized feature-flags modules into one module per concern: resolve types, schema validation and the fallback, evaluation and recovery reports leave `feature-flags-resolve.ts`; the definition, server and client types leave their factories; the LaunchDarkly adapter's options, evaluation report and read mapping get their own modules. The public exports and behavior are unchanged, so this is a patch.
