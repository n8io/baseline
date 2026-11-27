import { LaunchDarklyProvider } from "@launchdarkly/openfeature-node-server";
import { sharedTimeRace } from "@n8io/baseline-shared";
import {
	type EvaluationContext,
	type JsonValue,
	NOOP_PROVIDER,
	OpenFeature,
} from "@openfeature/server-sdk";
import type { FeatureFlagKinds } from "../core/feature-flags-context.ts";
import type { FeatureFlagDefinitions } from "../core/feature-flags-define-types.ts";
import {
	featureFlagsOptionsDomainCreate,
	featureFlagsOptionsStringRequire,
	featureFlagsOptionsTimeoutMsResolve,
} from "../core/feature-flags-options.ts";
import type {
	FeatureFlagFallback,
	FeatureFlagsReadyStatus,
} from "../core/feature-flags-resolve-types.ts";
import { featureFlagsServerCreate } from "../core/feature-flags-server.ts";
import type {
	FeatureFlags,
	FeatureFlagsServerSource,
} from "../core/feature-flags-server-types.ts";
import { featureFlagsLoggerDefault as logger } from "../feature-flags-logger-default.ts";
import { featureFlagsLaunchDarklyContext } from "./feature-flags-launch-darkly-context.ts";
import { featureFlagsLaunchDarklyEvaluationReport } from "./feature-flags-launch-darkly-evaluation-report.ts";
import { featureFlagsLaunchDarklyRead } from "./feature-flags-launch-darkly-read.ts";
import type { FeatureFlagsLaunchDarklyOptions } from "./feature-flags-launch-darkly-types.ts";

// Bounds close(), so shutdown never waits long on LaunchDarkly delivering its last events.
const closeTimeoutMs = 2000;

const fallbackLog = ({ flag, key, reason }: FeatureFlagFallback): void => {
	logger.warn({ flag, key, reason }, "Feature flag fell back to its default");
};

const recoveredLog = (): void => {
	logger.info("Feature flag service answers again");
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
					return featureFlagsLaunchDarklyRead(
						await client.getBooleanDetails(key, fallback, evaluationContext),
					);
				case "number":
					return featureFlagsLaunchDarklyRead(
						await client.getNumberDetails(key, fallback, evaluationContext),
					);
				case "string":
					return featureFlagsLaunchDarklyRead(
						await client.getStringDetails(key, fallback, evaluationContext),
					);
				case "object":
					return featureFlagsLaunchDarklyRead(
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
		onEvaluation: featureFlagsLaunchDarklyEvaluationReport,
		onFallback: onFallback ?? fallbackLog,
		onRecovered: recoveredLog,
		source,
	});
};
