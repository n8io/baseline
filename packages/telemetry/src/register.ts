// The preload: node --import @n8io/baseline-telemetry/register
// --experimental-loader=@opentelemetry/instrumentation/hook.mjs (spec 4.4).
// Without the loader hook, ESM modules are not patched and http server spans
// are missing.
import { telemetryStart } from "./telemetry-sdk.ts";

telemetryStart();
