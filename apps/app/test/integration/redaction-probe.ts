// Started by redaction.test.ts with the varlock preload: logs a sensitive value through the
// app's pino logger under a key the logger's own redact paths do not cover.
import { logger } from "@n8io/baseline-logger";
import { ENV } from "varlock/env";

logger.info({ clientSecret: ENV.AUTHN_CLIENT_SECRET }, "redaction probe");
