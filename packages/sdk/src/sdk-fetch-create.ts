// The fetch a Project's generated SDK calls. Each call has a timeout per attempt and one for the
// whole call; a GET, HEAD or DELETE that fails in a way worth retrying is sent again. A call
// resolves `{ status, data, headers }` for every status and never throws on one; it rejects only
// when no response came: a timeout (a DOMException named TimeoutError), a network failure (the
// error fetch gave), or a missing base URL.
import ky, { isHTTPError, isNetworkError, isTimeoutError } from "ky";

export type SdkOptions = {
	/** The API's origin, such as https://api.example.com; operation paths start with /api/v1. */
	baseUrl?: string;
	/** How many times a failed GET, HEAD or DELETE is sent again; 0 turns retries off. Default 2. */
	retry?: number;
	/** Milliseconds each attempt may take until its response headers arrive. Default 10000. */
	timeout?: number;
	token?: string;
	/** Milliseconds the whole call may take, retries, waits and the body included. Default 30000. */
	totalTimeout?: number;
};

export type SdkFetch = {
	/** Sets options every later call uses unless the call passes its own. */
	sdkConfigure(options: SdkOptions): void;
	sdkFetch<T>(url: string, options: RequestInit & SdkOptions): Promise<T>;
};

// POST and PATCH are never retried: without an Idempotency-Key a retry could apply them twice.
const methodsRetried = ["get", "head", "delete"];
const statusesRetried = [408, 429, 500, 502, 503, 504];

// Retry-After in milliseconds: seconds, or an HTTP date.
const retryAfterMillis = (value: string | null): number | undefined => {
	if (value === null) return undefined;
	const millis = /^\d+$/.test(value)
		? Number(value) * 1000
		: Date.parse(value) - Date.now();
	return Number.isNaN(millis) ? undefined : Math.max(0, millis);
};

const dataRead = (text: string, headers: Headers): unknown => {
	if (text === "") return undefined;
	return headers.get("content-type")?.includes("json")
		? (JSON.parse(text) as unknown)
		: text;
};

const timeoutError = (): DOMException =>
	new DOMException("The SDK call timed out", "TimeoutError");

export const sdkFetchCreate = (defaults?: SdkOptions | null): SdkFetch => {
	let configured: SdkOptions = { ...defaults };

	const sdkFetch = async <T>(
		url: string,
		options: RequestInit & SdkOptions,
	): Promise<T> => {
		const {
			baseUrl = configured.baseUrl,
			retry = configured.retry ?? 2,
			timeout = configured.timeout ?? 10_000,
			token = configured.token,
			totalTimeout = configured.totalTimeout ?? 30_000,
			...init
		} = options;
		if (baseUrl === undefined) {
			throw new Error("No API URL: call sdkConfigure({ baseUrl }) first");
		}
		const headers = new Headers(init.headers);
		if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
		// Bounds the body read too, which ky's own totalTimeout does not cover once it returns.
		const deadline = Date.now() + totalTimeout;
		const totalSignal = AbortSignal.timeout(totalTimeout);
		const signal =
			init.signal == null
				? totalSignal
				: AbortSignal.any([init.signal, totalSignal]);
		try {
			const response = await ky(`${baseUrl.replace(/\/+$/, "")}${url}`, {
				...init,
				headers,
				retry: {
					afterStatusCodes: statusesRetried,
					limit: retry,
					methods: methodsRetried,
					retryOnTimeout: true,
					// A Retry-After past the deadline returns this response now instead of waiting.
					shouldRetry: ({ error }) =>
						isHTTPError(error) &&
						Date.now() +
							(retryAfterMillis(error.response.headers.get("retry-after")) ??
								0) >=
							deadline
							? false
							: undefined,
					statusCodes: statusesRetried,
				},
				signal,
				// Only a retryable status throws inside ky, so it can retry; the catch maps it back.
				throwHttpErrors: (status) => statusesRetried.includes(status),
				timeout,
				totalTimeout,
			});
			const text = await response.text();
			return {
				data: dataRead(text, response.headers),
				headers: response.headers,
				status: response.status,
			} as T;
		} catch (error) {
			if (isHTTPError(error)) {
				return {
					data: error.data,
					headers: error.response.headers,
					status: error.response.status,
				} as T;
			}
			if (isTimeoutError(error)) throw timeoutError();
			if (isNetworkError(error)) throw error.cause;
			throw error;
		}
	};

	return {
		sdkConfigure: (options) => {
			configured = { ...configured, ...options };
		},
		sdkFetch,
	};
};
