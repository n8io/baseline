// The one source of the Node preloads, in order: secrets (varlock) first, then the
// OpenTelemetry ESM loader hook, then the telemetry SDK. Every entry runs
// `node --import ./src/preload.ts <entry>`; the image sets it once in NODE_OPTIONS.
// Without the loader hook, ESM modules are not patched and http server spans are missing.
import "varlock/auto-load";
import { register } from "node:module";

register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);
await import("@n8io/baseline-telemetry/register");
