import type { LDOptions } from "@launchdarkly/node-server-sdk";
import { LaunchDarklyProvider } from "@launchdarkly/openfeature-node-server";
import { logger } from "@n8io/baseline-logger";
import { sharedTimeRace } from "@n8io/baseline-shared";
import {
	type EvaluationContext,
	type EvaluationDetails,
	type JsonValue,
	NOOP_PROVIDER,
	OpenFeature,
} from "@openfeature/server-sdk";
import type { FeatureFlagKinds } from "../core/feature-flags-context.ts";
import type { FeatureFlagDefinitions } from "../core/feature-flags-define.ts";
import {
	featureFlagsOptionsDomainCreate,
	featureFlagsOptionsStringRequire,
	featureFlagsOptionsTimeoutMsResolve,
} from "../core/feature-flags-options.ts";
import type {
	FeatureFlagEvaluation,
	FeatureFlagFallback,
	FeatureFlagRead,
	FeatureFlagsOnFallback,
	FeatureFlagsReadyStatus,
} from "../core/feature-flags-resolve.ts";
import {
	type FeatureFlags,
	type FeatureFlagsServerSource,
	featureFlagsServerCreate,
} from "../core/feature-flags-server.ts";
import { featureFlagsLaunchDarklyContext } from "./feature-flags-launch-darkly-context.ts";
import { featureFlagsLaunchDarklyEvaluationRecord } from "./feature-flags-launch-darkly-evaluation.ts";

// Bounds close(), so shutdown never waits long on LaunchDarkly delivering its last events.
const closeTimeoutMs = 2000;

/**
 * LaunchDarkly's own SDK options, named as its SDK names them. Outside this Package's contract:
 * moving off LaunchDarkly deletes it. Examples: `baseUri`, `logger`, `proxyOptions`.
 */
export type FeatureFlagsLaunchDarklyVendorOptions = LDOptions;

/** What `featureFlagsLaunchDarklyCreate` takes. */
export type FeatureFlagsLaunchDarklyOptions<
	D extends FeatureFlagDefinitions,
	K extends FeatureFlagKinds,
> = {
	readonly flags: D;
	/** The kinds a context can hold. Each needs a context kind of the same name in LaunchDarkly. */
	readonly kinds?: K | null;
	/** Receives each fallback a read returns. Defaults to logging it as a warning. */
	readonly onFallback?: FeatureFlagsOnFallback | null;
	/** How long `ready` waits for LaunchDarkly before it settles `timeout`. Default 2000. A value that is not a whole number of milliseconds from 1 up throws a `TypeError`. */
	readonly readyTimeoutMs?: number | null;
	/** The LaunchDarkly server SDK key, for the environment the process runs in. An empty one throws a `TypeError`. */
	readonly sdkKey: string;
	/** Settings only LaunchDarkly has, passed to its SDK. */
	readonly vendor?: FeatureFlagsLaunchDarklyVendorOptions | null;
};

const fallbackLog = ({ flag, key, reason }: FeatureFlagFallback): void => {
	logger.warn({ flag, key, reason }, "Feature flag fell back to its default");
};

const recoveredLog = (): void => {
	logger.info("Feature flag service answers again");
};

// LaunchDarkly's reason kinds, and OpenFeature's, as the convention names them.
const reasonsConvention: Readonly<Record<string, string>> = {
	CACHED: "cached",
	DEFAULT: "default",
	DISABLED: "disabled",
	ERROR: "error",
	FALLTHROUGH: "default",
	OFF: "disabled",
	RULE_MATCH: "targeting_match",
	SPLIT: "split",
	STALE: "stale",
	STATIC: "static",
	TARGET_MATCH: "targeting_match",
	TARGETING_MATCH: "targeting_match",
};

// The convention's error.type for each fallback. A read that failed is reason "error".
const errorTypes: Readonly<Record<string, string>> = {
	closed: "general",
	notFound: "flag_not_found",
	notInValues: "parse_error",
	notReady: "provider_not_ready",
	schemaFailed: "parse_error",
	vendorError: "general",
	wrongType: "type_mismatch",
};

// Records each evaluation as the OpenTelemetry `feature_flag.evaluation` event. Never the context.
const evaluationRecord = ({
	fallbackReason,
	key,
	reason,
	value,
	variant,
}: FeatureFlagEvaluation): void => {
	featureFlagsLaunchDarklyEvaluationRecord({
		errorType:
			fallbackReason === null ? null : (errorTypes[fallbackReason] ?? null),
		key,
		providerName: "launchdarkly",
		reason:
			fallbackReason === null
				? (reasonsConvention[reason ?? ""] ?? "unknown")
				: "error",
		value,
		variant,
	});
};

const readOf = ({
	errorCode,
	reason,
	value,
	variant,
}: {
	readonly errorCode?: EvaluationDetails<JsonValue>["errorCode"];
	readonly reason?: string;
	readonly value: unknown;
	readonly variant?: string;
}): FeatureFlagRead => {
	switch (errorCode) {
		case undefined:
			return {
				found: true,
				reason: reason ?? null,
				value,
				variant: variant ?? null,
			};
		case "FLAG_NOT_FOUND":
			return { found: false, reason: "notFound" };
		case "TYPE_MISMATCH":
			return { found: false, reason: "wrongType" };
		default:
			return { found: false, reason: "vendorError" };
	}
};

const statusAfter = async ({
	pending,
	timeoutMs,
}: {
	pending: Promise<unknown>;
	timeoutMs: number;
}): Promise<FeatureFlagsReadyStatus> => {
	return sharedTimeRace({
		ms: timeoutMs,
		value: "timeout" as const,
		work: pending.then(
			() => "connected" as const,
			() => "failed" as const,
		),
	});
};

/**
 * The server's flags backed by LaunchDarkly, through its OpenFeature provider in a domain of its
 * own. Never throws and never blocks boot: `ready` settles `connected`, `failed` or `timeout`, and
 * reads return fallbacks until it is connected. `close()` closes only this instance.
 */
export const featureFlagsLaunchDarklyCreate = <
	const D extends FeatureFlagDefinitions,
	const K extends FeatureFlagKinds = Record<never, never>,
>({
	flags,
	onFallback,
	readyTimeoutMs,
	sdkKey,
	vendor,
}: FeatureFlagsLaunchDarklyOptions<D, K>): FeatureFlags<D, K> => {
	featureFlagsOptionsStringRequire({
		factory: "featureFlagsLaunchDarklyCreate",
		name: "sdkKey",
		value: sdkKey,
	});
	const timeoutMs = featureFlagsOptionsTimeoutMsResolve({
		factory: "featureFlagsLaunchDarklyCreate",
		readyTimeoutMs,
	});
	const domain = featureFlagsOptionsDomainCreate();
	// Opens with an unbounded init wait: `ready` gives up on its own timer, and the SDK keeps
	// trying, so a slow LaunchDarkly still connects later.
	const provider = new LaunchDarklyProvider(sdkKey, vendor ?? {}, "forever");
	const opened = OpenFeature.setProviderAndWait(domain, provider);
	const client = OpenFeature.getClient(domain);
	const source: FeatureFlagsServerSource = {
		close: async () => {
			// Only this instance's provider: the global OpenFeature.close() would close every other
			// instance's too. Closing first lets the flush finish before the domain is unbound.
			await sharedTimeRace({
				ms: closeTimeoutMs,
				value: undefined,
				work: provider.onClose().catch(() => undefined),
			});
			OpenFeature.setProvider(domain, NOOP_PROVIDER);
		},
		read: async ({ context, fallback, key }) => {
			const evaluationContext: EvaluationContext =
				featureFlagsLaunchDarklyContext(context);
			switch (typeof fallback) {
				case "boolean":
					return readOf(
						await client.getBooleanDetails(key, fallback, evaluationContext),
					);
				case "number":
					return readOf(
						await client.getNumberDetails(key, fallback, evaluationContext),
					);
				case "string":
					return readOf(
						await client.getStringDetails(key, fallback, evaluationContext),
					);
				case "object":
					return readOf(
						await client.getObjectDetails(
							key,
							// boundary: an object flag's fallback is JSON, as LaunchDarkly stores it
							fallback as JsonValue,
							evaluationContext,
						),
					);
				default:
					return { found: false, reason: "wrongType" };
			}
		},
		ready: statusAfter({
			pending: opened,
			timeoutMs,
		}),
	};
	return featureFlagsServerCreate<D, K>({
		flags,
		onEvaluation: evaluationRecord,
		onFallback: onFallback ?? fallbackLog,
		onRecovered: recoveredLog,
		source,
	});
};
