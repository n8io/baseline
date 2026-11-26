import { sharedTimeRace } from "@n8io/baseline-shared";
import {
	ClientProviderStatus,
	ErrorCode,
	type EvaluationDetails,
	type JsonValue,
	NOOP_PROVIDER,
	OpenFeature,
	type FlagValue as OpenFeatureValue,
	type Provider,
	ProviderEvents,
	ProviderStatus,
} from "@openfeature/web-sdk";
import type { FeatureFlagsClientSource } from "../core/feature-flags-client-types.ts";
import type { FeatureFlagContextResolved } from "../core/feature-flags-context.ts";
import type {
	FeatureFlagRead,
	FeatureFlagsReadyStatus,
} from "../core/feature-flags-resolve-types.ts";
import { featureFlagsLaunchDarklyClientContextTranslate } from "./feature-flags-launch-darkly-client-context.ts";

const events = [
	ProviderEvents.ConfigurationChanged,
	ProviderEvents.ContextChanged,
	ProviderEvents.Ready,
] as const;

// The LaunchDarkly provider accepts any `typeof "object"` as a JSON flag, which lets null and
// arrays through. A JSON flag is an object unless its fallback says otherwise.
const objectRead = ({
	fallback,
	read,
}: {
	fallback: unknown;
	read: FeatureFlagRead;
}): FeatureFlagRead =>
	read.found &&
	(read.value === null ||
		(Array.isArray(read.value) && !Array.isArray(fallback)))
		? { found: false, reason: "wrongType" }
		: read;

const readOfDetails = (
	details: EvaluationDetails<OpenFeatureValue>,
): FeatureFlagRead => {
	switch (details.errorCode) {
		case undefined:
			return details.reason === "ERROR"
				? { found: false, reason: "vendorError" }
				: { found: true, value: details.value };
		case ErrorCode.FLAG_NOT_FOUND:
			return { found: false, reason: "notFound" };
		case ErrorCode.TYPE_MISMATCH:
			return { found: false, reason: "wrongType" };
		default:
			return { found: false, reason: "vendorError" };
	}
};

/**
 * Builds the source the browser's flags read from, on this instance's own OpenFeature domain. The
 * provider is closed by replacing it on that domain, never by closing OpenFeature itself, so other
 * instances keep running.
 */
export const featureFlagsLaunchDarklyClientSourceCreate = ({
	context,
	domain,
	provider,
	readyTimeoutMs,
}: {
	context: FeatureFlagContextResolved;
	domain: string;
	provider: Provider;
	readyTimeoutMs: number;
}): FeatureFlagsClientSource => {
	const client = OpenFeature.getClient(domain);
	// OpenFeature calls a provider ready once its start returns; the LaunchDarkly one reports a
	// failed start through its own status, so both must say ready.
	const isReady = (): boolean =>
		client.providerStatus === ClientProviderStatus.READY &&
		(provider.status ?? ProviderStatus.READY) === ProviderStatus.READY;
	const connected = OpenFeature.setProviderAndWait(
		domain,
		provider,
		featureFlagsLaunchDarklyClientContextTranslate(context),
	).then(
		// The LaunchDarkly provider reports a failed start through its status, not by throwing.
		() => (isReady() ? "connected" : "failed"),
		() => "failed" as const,
	);
	const ready = sharedTimeRace<
		FeatureFlagsReadyStatus,
		FeatureFlagsReadyStatus
	>({
		ms: readyTimeoutMs,
		value: "timeout",
		work: connected,
	});
	return {
		close: async () => {
			await OpenFeature.setProviderAndWait(domain, NOOP_PROVIDER).catch(
				() => undefined,
			);
			await OpenFeature.clearContext(domain).catch(() => undefined);
		},
		contextSet: (next) =>
			OpenFeature.setContext(
				domain,
				featureFlagsLaunchDarklyClientContextTranslate(next),
			),
		read: ({ fallback, key }) => {
			if (!isReady()) {
				return { found: false, reason: "vendorError" };
			}
			switch (typeof fallback) {
				case "boolean":
					return readOfDetails(client.getBooleanDetails(key, fallback));
				case "number":
					return readOfDetails(client.getNumberDetails(key, fallback));
				case "string":
					return readOfDetails(client.getStringDetails(key, fallback));
				default:
					return objectRead({
						fallback,
						read: readOfDetails(
							// boundary: a fallback that is not a primitive is a JSON value
							client.getObjectDetails(key, fallback as JsonValue),
						),
					});
			}
		},
		ready,
		subscribe: (listener) => {
			for (const event of events) {
				client.addHandler(event, listener);
			}
			return () => {
				for (const event of events) {
					client.removeHandler(event, listener);
				}
			};
		},
	};
};
