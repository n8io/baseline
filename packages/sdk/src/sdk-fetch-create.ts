// The fetch a Project's generated SDK calls. Each call has a timeout per attempt and one for the
// whole call; a GET, HEAD or DELETE that fails in a way worth retrying is sent again. A call
// resolves `{ status, data, headers }` for every status and never throws on one; it rejects only
// when no response came: a timeout (a DOMException named TimeoutError), a network failure (the
// error fetch gave), or no environment to send it to.
import ky, { isHTTPError, isNetworkError, isTimeoutError } from "ky";

export type SdkOptions<E extends string = string> = {
	/** An API origin that overrides the environment, for tests, worktrees and one-off servers. */
	baseUrl?: string;
	/** Which of the instance's environments to call, such as "production". */
	environment?: E;
	/** How many times a failed GET, HEAD or DELETE is sent again; 0 turns retries off. Default 2. */
	retry?: number;
	/** Milliseconds each attempt may take until its response headers arrive. Default 10000. */
	timeout?: number;
	token?: string;
	/** Milliseconds the whole call may take, retries, waits and the body included. Default 30000. */
	totalTimeout?: number;
};

export type SdkFetch<E extends string = string> = {
	/** Sets options every later call uses unless the call passes its own. */
	sdkConfigure(options: SdkOptions<E>): void;
	sdkFetch<T>(url: string, options: RequestInit & SdkOptions<E>): Promise<T>;
};

export type SdkFetchCreateInput<E extends string> = {
	defaults?: SdkOptions<NoInfer<E>> | null;
	/** Each environment's name and its API origin, such as { production: "https://api.example.com" }. */
	environments?: Readonly<Record<E, string>> | null;
};

// POST and PATCH are never retried: without an Idempotency-Key a retry could apply them twice.
const methodsRetried = ["get", "head", "delete"];
const statusesRetried = [408, 429, 500, 502, 503, 504];

// ky's backoff, set here so the wait below matches it: 0.3 s, then doubling.
const backoffMillis = (retryCount: number): number =>
	300 * 2 ** (retryCount - 1);

// The headers ky waits by, in its order: seconds, a Unix time (the reset ones), or an HTTP date.
const timingHeaders = [
	"retry-after",
	"ratelimit-reset",
	"x-ratelimit-retry-after",
	"x-ratelimit-reset",
	"x-rate-limit-reset",
];

// How long ky will wait before sending again after this response.
const waitMillis = (headers: Headers, retryCount: number): number => {
	const value = timingHeaders
		.map((name) => headers.get(name))
		.find((found) => found !== null);
	if (value == null) return backoffMillis(retryCount);
	if (/^\d+$/.test(value)) {
		const seconds = Number(value);
		return seconds >= 1e9 ? seconds * 1000 - Date.now() : seconds * 1000;
	}
	const date = Date.parse(value);
	return Number.isNaN(date) ? backoffMillis(retryCount) : date - Date.now();
};

const dataRead = (text: string, headers: Headers): unknown => {
	if (text === "") return undefined;
	return headers.get("content-type")?.includes("json")
		? (JSON.parse(text) as unknown)
		: text;
};

const timeoutError = (): DOMException =>
	new DOMException("The SDK call timed out", "TimeoutError");

// With no environments, only baseUrl sends a call, as the CLI's own login does.
export const sdkFetchCreate = <E extends string = never>(
	input?: SdkFetchCreateInput<E> | null,
): SdkFetch<E> => {
	let configured: SdkOptions<E> = { ...input?.defaults };
	const environments: Partial<Record<string, string>> = {
		...input?.environments,
	};
	const names = Object.keys(environments).join(", ");

	// The call's baseUrl, else its environment, else the configured baseUrl, else the configured one.
	const baseUrlResolve = (options: SdkOptions<E>): string => {
		const environment = options.environment ?? configured.environment;
		const url =
			options.baseUrl ??
			(options.environment === undefined ? configured.baseUrl : undefined);
		if (url !== undefined) return url;
		if (names === "") {
			throw new Error("No API URL: call sdkConfigure({ baseUrl }) first");
		}
		if (environment === undefined) {
			throw new Error(
				`No environment: call sdkConfigure({ environment }) with one of ${names}`,
			);
		}
		const found = Object.hasOwn(environments, environment)
			? environments[environment]
			: undefined;
		if (found === undefined) {
			throw new Error(
				`Unknown environment "${environment}": use one of ${names}`,
			);
		}
		return found;
	};

	const sdkFetch = async <T>(
		url: string,
		options: RequestInit & SdkOptions<E>,
	): Promise<T> => {
		const baseUrl = baseUrlResolve(options);
		const {
			baseUrl: _baseUrl,
			environment: _environment,
			retry = configured.retry ?? 2,
			timeout = configured.timeout ?? 10_000,
			token = configured.token,
			totalTimeout = configured.totalTimeout ?? 30_000,
			...init
		} = options;
		const headers = new Headers(init.headers);
		if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
		const method = (init.method ?? "GET").toLowerCase();
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
				// A plain object: ky reads the value "undefined" in a Headers as a deletion.
				headers: Object.fromEntries(headers),
				// The raw text, so dataRead parses every status the same way.
				parseJson: (text) => text,
				retry: {
					afterStatusCodes: statusesRetried,
					delay: backoffMillis,
					// 0 for POST and PATCH, so ky does not copy a body it will never send again.
					limit: methodsRetried.includes(method) ? retry : 0,
					methods: methodsRetried,
					retryOnTimeout: true,
					// A response whose wait runs past the deadline resolves now instead of timing out.
					shouldRetry: ({ error, retryCount }) =>
						isHTTPError(error) &&
						Date.now() + waitMillis(error.response.headers, retryCount) >=
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
					data: dataRead(
						typeof error.data === "string" ? error.data : "",
						error.response.headers,
					),
					headers: error.response.headers,
					status: error.response.status,
				} as T;
			}
			if (isTimeoutError(error) || error === totalSignal.reason) {
				throw timeoutError();
			}
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
