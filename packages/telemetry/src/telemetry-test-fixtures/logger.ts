// Started by register.test.ts with the preload: logs one record through the app's logger,
// then flushes telemetry and exits.
import { logger } from "@n8io/baseline-logger";
import { telemetryShutdown } from "@n8io/baseline-telemetry";

logger.info("fixture record");
await telemetryShutdown();
