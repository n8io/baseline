// The telemetry SDK preload. Import it from the Project's own preload file, after
// register() from "import-in-the-middle/register-hooks.mjs", as the README shows. Without the loader hook, ESM modules are not patched and http
// server spans are missing.
import { telemetryStart } from "./telemetry.ts";

telemetryStart();
