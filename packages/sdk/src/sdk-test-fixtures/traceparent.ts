// Started by sdk-traceparent.test.ts with `--import @n8io/baseline-telemetry/register`, as a
// Project's preload starts telemetry: calls the API whose URL is its argument inside a span,
// then flushes telemetry and exits.
import { telemetryShutdown } from "@n8io/baseline-telemetry";
import { telemetrySpanRun } from "@n8io/baseline-telemetry/span";
import { sdkFetchCreate } from "../sdk-fetch-create.ts";

const { sdkFetch } = sdkFetchCreate({
	defaults: { environment: "test" },
	environments: { test: process.argv[2] ?? "" },
});

await telemetrySpanRun("caller", () =>
	sdkFetch("/api/v1/foos", { method: "GET" }),
);
await telemetryShutdown();
