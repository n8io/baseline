// Started by sdk-fetch-traceparent.test.ts with `--import @n8io/baseline-telemetry/register`, as a
// Project's preload starts telemetry. It prints a ready line once everything is loaded, waits for a
// line on stdin, then calls the API whose URL is its argument inside a span, flushes telemetry and
// exits. The test waits for the ready line, so a slow start never counts against its own timeout.
import { createInterface } from "node:readline";
import { telemetryShutdown } from "@n8io/baseline-telemetry";
import { telemetrySpanRun } from "@n8io/baseline-telemetry/span";
import { sdkFetchCreate } from "../sdk-fetch.ts";

const { sdkFetch } = sdkFetchCreate({
	defaults: { environment: "test" },
	environments: { test: process.argv[2] ?? "" },
});

console.log("ready");
await createInterface({ input: process.stdin })[Symbol.asyncIterator]().next();

await telemetrySpanRun("caller", () =>
	sdkFetch("/api/v1/foos", { method: "GET" }),
);
await telemetryShutdown();
