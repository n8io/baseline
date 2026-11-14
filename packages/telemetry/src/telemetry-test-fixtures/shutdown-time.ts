// Started by register.test.ts with the preload and no OTEL_* variable: prints how long
// telemetryShutdown took, in milliseconds.
import { logger } from "@n8io/baseline-logger";
import { telemetryShutdown } from "@n8io/baseline-telemetry";

logger.info("fixture record");
const startedAt = performance.now();
await telemetryShutdown();
console.log(Math.round(performance.now() - startedAt));
