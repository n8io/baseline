---
"app": patch
"@n8io/baseline-telemetry": patch
---

The preload registers the OpenTelemetry ESM loader hook in-thread with `register()` from `import-in-the-middle/register-hooks.mjs` (`module.registerHooks`), so Node 26 no longer prints `[DEP0205] module.register() is deprecated` at startup. To match in your Project, replace `@opentelemetry/instrumentation` with `import-in-the-middle` (`^3.6.0`) in package.json and change `src/preload.ts` to:

```ts
import { register } from "import-in-the-middle/register-hooks.mjs";

register();
await import("@n8io/baseline-telemetry/register");
```

`@n8io/baseline-telemetry` no longer lists `@opentelemetry/instrumentation` as a direct dependency; its instrumentations still bring it.
