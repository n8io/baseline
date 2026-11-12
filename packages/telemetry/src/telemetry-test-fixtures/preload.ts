// The preload register.test.ts starts each fixture with, in the shape the
// Template uses (apps/app/src/preload.ts): the OpenTelemetry ESM loader hook
// first, then the telemetry SDK.
import { register } from "import-in-the-middle/register-hooks.mjs";

register();
await import("@n8io/baseline-telemetry/register");
