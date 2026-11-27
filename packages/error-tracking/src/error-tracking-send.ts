import type { Logger } from "@n8io/baseline-logger";
import type { TransportMakeRequestResponse } from "@sentry/core";

// Bounds each send, so a stuck request never holds a slot in the send queue.
const sendTimeoutMs = 5000;

type SendOptions = {
	body: string | Uint8Array;
	logger: Pick<Logger, "warn">;
	url: string;
};

/** POSTs an envelope, warns when refused, and hands back the rate-limit headers the transport honours. */
export const errorTrackingSend = async ({
	body,
	logger,
	url,
}: SendOptions): Promise<TransportMakeRequestResponse> => {
	const response = await fetch(url, {
		// A copy, typed as the ArrayBuffer-backed bytes fetch takes.
		body: typeof body === "string" ? body : body.slice(),
		method: "POST",
		signal: AbortSignal.timeout(sendTimeoutMs),
	});
	await response.body?.cancel();
	if (!response.ok) {
		logger.warn({ status: response.status }, "Sentry refused an error report");
	}
	return {
		headers: {
			"retry-after": response.headers.get("retry-after"),
			"x-sentry-rate-limits": response.headers.get("x-sentry-rate-limits"),
		},
		statusCode: response.status,
	};
};
