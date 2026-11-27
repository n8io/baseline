import type { ErrorEvent } from "@sentry/core";

// What an Error report carries; beforeSend drops every other field the SDK adds.
const eventKeys = new Set([
	"dist",
	"environment",
	"event_id",
	"exception",
	"level",
	"platform",
	"release",
	"sdk",
	// Never sent as is: the envelope's trace header is built from it.
	"sdkProcessingMetadata",
	"tags",
	"timestamp",
	"type",
]);
const contextKeys = new Set(["runtime", "trace"]);

const keysKeep = <T extends object>(value: T, keys: Set<string>): T =>
	Object.fromEntries(
		Object.entries(value).filter(([key]) => keys.has(key)),
	) as T;

export const errorTrackingEventAllowlist = (event: ErrorEvent): ErrorEvent => ({
	...keysKeep(event, eventKeys),
	contexts: keysKeep(event.contexts ?? {}, contextKeys),
});
