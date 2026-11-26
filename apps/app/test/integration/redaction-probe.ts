// Started by redaction.test.ts with the varlock preload: logs a sensitive value through the
// app's pino logger under a key the logger's own redact paths do not cover.
import { loggerCreate } from "@n8io/baseline-logger";
import { ENV } from "varlock/env";

const logger = loggerCreate();

logger.info({ clientSecret: ENV.AUTHN_CLIENT_SECRET }, "redaction probe");
