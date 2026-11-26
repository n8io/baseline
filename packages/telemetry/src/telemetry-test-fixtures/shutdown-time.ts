// Started by register.test.ts with the preload and the OTEL_* variables the test sets: prints how long
// telemetryShutdown took, in milliseconds.
import { loggerCreate } from "@n8io/baseline-logger";
import { telemetryShutdown } from "@n8io/baseline-telemetry";

const logger = loggerCreate();

logger.info("fixture record");
const startedAt = performance.now();
await telemetryShutdown();
console.log(Math.round(performance.now() - startedAt));
