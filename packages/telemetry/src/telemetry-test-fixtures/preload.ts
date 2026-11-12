// The preload register.test.ts starts each fixture with, in the shape the
// Template uses (apps/app/src/preload.ts): the OpenTelemetry ESM loader hook
// first, then the telemetry SDK.
import { register } from "node:module";

register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);
await import("@n8io/baseline-telemetry/register");
