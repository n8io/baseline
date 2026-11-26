// Started by register.test.ts with the preload: logs one record through the app's logger,
// then flushes telemetry and exits.
import { loggerCreate } from "@n8io/baseline-logger";
import { telemetryShutdown } from "@n8io/baseline-telemetry";

const logger = loggerCreate();

logger.info("fixture record");
await telemetryShutdown();
