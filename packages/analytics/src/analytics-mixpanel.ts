import { sharedVendorKeyRefused } from "@n8io/baseline-shared";
import type { Analytics } from "./analytics.ts";
import { analyticsLoggerDefault as logger } from "./analytics-logger-default.ts";

const trackHost = "api.mixpanel.com";
// Bounds each send, so close() never waits longer than this.
const sendTimeoutMs = 5000;

/**
 * Mixpanel's own settings, named as the `mixpanel` SDK's init config names them. Outside this
 * Package's contract: moving off Mixpanel deletes it. Any other key throws. Not exported from the
 * Package: write the object inline in `src/analytics-open.ts`, where `analyticsMixpanelCreate` takes it.
 */
type AnalyticsMixpanelVendorOptions = {
	/** The ingestion host, for data residency: `api-eu.mixpanel.com` or `api-in.mixpanel.com`. */
	host?: string | null;
};

const vendorKeys = ["host"] as const;

/** What `analyticsMixpanelCreate` takes. */
export type AnalyticsMixpanelOptions = {
	/** The Mixpanel project token. */
	token: string;
	/** Settings only Mixpanel has: `host`. Any other key throws, since it would do nothing. */
	vendor?: AnalyticsMixpanelVendorOptions | null;
};

// Plain fetch, not the `mixpanel` SDK: 0.19.1 to 0.24.0 throw on init when HTTPS_PROXY is set
// (https://github.com/mixpanel/mixpanel-node/issues/252). This file is the only one that knows
// how events reach Mixpanel; README.md "Moving to the mixpanel SDK" says how to swap it.

/**
 * Sends each event to Mixpanel's /track, one request per event, with geolocation off and a 5 s
 * timeout per send. Throws a `TypeError` on an empty `token`, a `vendor` key other than `host`, or
 * a `vendor.host` that is not a bare host name.
 */
export const analyticsMixpanelCreate = ({
	token,
	vendor,
}: AnalyticsMixpanelOptions): Analytics => {
	if (token === "") {
		throw new TypeError("analyticsMixpanelCreate: token must not be empty");
	}
	const refused = sharedVendorKeyRefused({ allowed: vendorKeys, vendor });
	if (refused !== undefined) {
		throw new TypeError(
			`analyticsMixpanelCreate: vendor.${refused} is not allowed: only ${vendorKeys.join(", ")} reaches Mixpanel`,
		);
	}
	const host = vendor?.host ?? trackHost;
	// A host with a scheme, a path or nothing in it would send the token somewhere else.
	if (
		!URL.canParse(`https://${host}`) ||
		new URL(`https://${host}`).host !== host
	) {
		throw new TypeError(
			`analyticsMixpanelCreate: vendor.host must be a bare host name such as api-eu.mixpanel.com, found ${JSON.stringify(host)}`,
		);
	}
	// ip=0: the server's IP is not the Actor's, so Mixpanel must not geolocate it. strict=1: a
	// malformed event answers 400 instead of being dropped silently.
	const trackUrl = `https://${host}/track?ip=0&strict=1`;
	const sending = new Set<Promise<void>>();
	const close = async (): Promise<void> => {
		await Promise.all(sending);
	};
	return {
		close,
		[Symbol.asyncDispose]: close,
		track: ({ actorId, name, properties }) => {
			const sent = fetch(trackUrl, {
				body: JSON.stringify([
					{
						event: name,
						properties: { ...properties, distinct_id: actorId, token },
					},
				]),
				headers: { "content-type": "application/json" },
				method: "POST",
				signal: AbortSignal.timeout(sendTimeoutMs),
			})
				.then(async (response) => {
					await response.body?.cancel();
					if (!response.ok) {
						throw new Error(`Mixpanel answered ${response.status}`);
					}
				})
				.catch((error: unknown) => {
					logger.warn(
						{ err: error, event: name },
						"Dropped an analytics event",
					);
				})
				.finally(() => sending.delete(sent));
			sending.add(sent);
		},
	};
};
