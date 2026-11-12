// The telemetry SDK preload. Import it from the app's own preload file, after
// register("@opentelemetry/instrumentation/hook.mjs", import.meta.url), as the
// README shows. Without the loader hook, ESM modules are not patched and http
// server spans are missing.
import { telemetryStart } from "./telemetry-sdk.ts";

telemetryStart();
