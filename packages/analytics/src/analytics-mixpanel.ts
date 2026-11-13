import { logger } from "@n8io/baseline-logger";
import type { Analytics } from "./analytics.ts";

const trackHost = "api.mixpanel.com";
// Bounds each send, so close() never waits longer than this.
const sendTimeoutMs = 5000;

/**
 * Mixpanel's own settings, named as the `mixpanel` SDK's init config names them. Outside this
 * Package's contract: moving off Mixpanel deletes it.
 */
export type AnalyticsMixpanelVendorOptions = {
	/** The ingestion host, for data residency: `api-eu.mixpanel.com` or `api-in.mixpanel.com`. */
	host?: string;
};

// Sends each event to Mixpanel's /track, one request per event. Plain fetch, not the `mixpanel`
// SDK: 0.19.1 to 0.24.0 throw on init when HTTPS_PROXY is set
// (https://github.com/mixpanel/mixpanel-node/issues/252). This file is the only one that knows
// how events reach Mixpanel; README.md "Moving to the mixpanel SDK" says how to swap it.
export const analyticsMixpanelCreate = ({
	token,
	vendor = {},
}: {
	token: string;
	vendor?: AnalyticsMixpanelVendorOptions;
}): Analytics => {
	const host = vendor.host ?? trackHost;
	// A host with a scheme, a path or nothing in it would send the token somewhere else.
	if (
		!URL.canParse(`https://${host}`) ||
		new URL(`https://${host}`).host !== host
	) {
		throw new TypeError(
			`vendor.host must be a bare host name such as api-eu.mixpanel.com, not ${JSON.stringify(host)}`,
		);
	}
	// ip=0: the server's IP is not the Actor's, so Mixpanel must not geolocate it. strict=1: a
	// malformed event answers 400 instead of being dropped silently.
	const trackUrl = `https://${host}/track?ip=0&strict=1`;
	const sending = new Set<Promise<void>>();
	return {
		close: async () => {
			await Promise.all(sending);
		},
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
