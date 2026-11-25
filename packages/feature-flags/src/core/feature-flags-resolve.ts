import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { FeatureFlagDefinition } from "./feature-flags-define.ts";

/** Why a read returned the declared fallback instead of the flag service's value. */
export type FeatureFlagFallbackReason =
	| "closed"
	| "notFound"
	| "notInValues"
	| "notReady"
	| "schemaFailed"
	| "vendorError"
	| "wrongType";

/** What is logged when a read returns the fallback: the flag's name, its key and why. */
export type FeatureFlagFallback = {
	readonly flag: string;
	readonly key: string;
	readonly reason: FeatureFlagFallbackReason;
};

/** What a flag service answered for one key: a value of any type, or why it has none. */
export type FeatureFlagRead =
	| { readonly found: true; readonly value: unknown }
	| {
			readonly found: false;
			readonly reason: "notFound" | "vendorError" | "wrongType";
	  };

/**
 * Where a flag service stands: `connected`, `failed` (it said no) or `timeout` (it did not answer in
 * time). Reads return fallbacks until it is connected.
 */
export type FeatureFlagsReadyStatus = "connected" | "failed" | "timeout";

type SchemaResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly async: boolean };

/** Runs a Standard Schema that must answer at once. A throw or a Promise is a failure. */
export const featureFlagsSchemaValidate = ({
	schema,
	value,
}: {
	schema: StandardSchemaV1;
	value: unknown;
}): SchemaResult => {
	try {
		const result = schema["~standard"].validate(value);
		if (result instanceof Promise) {
			return { async: true, ok: false };
		}
		return result.issues === undefined
			? { ok: true, value: result.value }
			: { async: false, ok: false };
	} catch {
		return { async: false, ok: false };
	}
};

/** What a read returns: the value, and the reason it is the fallback when it is. */
export type FeatureFlagResolved = {
	readonly reason: FeatureFlagFallbackReason | null;
	readonly value: unknown;
};

/**
 * Turns the flag service's answer into the value the Project declared: the answer when it has the
 * declared type, else the fallback and the reason. Never throws.
 */
export const featureFlagsResolve = ({
	definition,
	read,
}: {
	definition: FeatureFlagDefinition;
	read: FeatureFlagRead;
}): FeatureFlagResolved => {
	const fallback = (reason: FeatureFlagFallbackReason) => ({
		reason,
		value: definition.fallback,
	});
	if (!read.found) {
		return fallback(read.reason);
	}
	const { value } = read;
	if (definition.schema !== undefined) {
		const result = featureFlagsSchemaValidate({
			schema: definition.schema,
			value,
		});
		return result.ok
			? { reason: null, value: result.value }
			: fallback("schemaFailed");
	}
	if (typeof value !== typeof definition.fallback) {
		return fallback("wrongType");
	}
	if (
		definition.values !== undefined &&
		!definition.values.some((allowed) => allowed === value)
	) {
		return fallback("notInValues");
	}
	return { reason: null, value };
};
