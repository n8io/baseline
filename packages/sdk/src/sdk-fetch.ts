// The fetch a Project's generated SDK calls. Each call has a timeout per attempt and one for the
// whole call; a GET, HEAD or DELETE that fails in a way worth retrying is sent again. A call
// resolves `{ status, data, headers }` for every status and never throws on one; it rejects only
// when no response came: a timeout (a DOMException named TimeoutError), a network failure (the
// error fetch gave), or no environment to send it to.
import { sharedIntegerAssert, sharedTimerMaxMs } from "@n8io/baseline-shared";
import ky, { isHTTPError, isNetworkError, isTimeoutError } from "ky";

/** What one call, or every call of an instance, may set. `null` or a missing field means the default. */
export type SdkOptions<E extends string = string> = {
	/** An API origin that overrides the environment, for tests, worktrees and one-off servers. */
	baseUrl?: string | null;
	/** Which of the instance's environments to call, such as "production". */
	environment?: E | null;
	/** How many times a failed GET, HEAD or DELETE is sent again; 0 turns retries off. Default 2. */
	retry?: number | null;
	/** Milliseconds each attempt may take until its response headers arrive. Default 10000. */
	timeoutMs?: number | null;
	/** Sent as `authorization: Bearer <token>`. */
	token?: string | null;
	/** Milliseconds the whole call may take, retries, waits and the body included. Default 30000. */
	totalTimeoutMs?: number | null;
};

/** One instance: the generated SDK's mutator and the function that sets its options. */
export type SdkFetch<E extends string = string> = {
	/** Sets options every later call uses unless the call passes its own. */
	sdkConfigure(options: SdkOptions<E>): void;
	/** Sends one call; `options` is `RequestInit` plus `SdkOptions` for this call only. */
	sdkFetch<T>(url: string, options: RequestInit & SdkOptions<E>): Promise<T>;
};

/** What `sdkFetchCreate` takes: the environments and the options every call starts from. */
export type SdkFetchOptions<E extends string = string> = {
	defaults?: SdkOptions<NoInfer<E>> | null;
	/** Each environment's name and its API origin, such as { production: "https://api.example.com" }. */
	environments?: Readonly<Record<E, string>> | null;
};

// A bad retry or timeout throws a TypeError naming the function and the option, as every Package does.
// `scope` is what the option name starts with, such as "defaults." for the factory's defaults.
const optionsCheck = ({
	caller,
	options,
	scope = "",
}: {
	caller: string;
	options: SdkOptions;
	scope?: string;
}): void => {
	const { retry, timeoutMs, totalTimeoutMs } = options;
	if (retry != null) {
		sharedIntegerAssert({
			caller,
			min: 0,
			name: `${scope}retry`,
			value: retry,
		});
	}
	for (const [name, value] of Object.entries({ timeoutMs, totalTimeoutMs })) {
		if (value != null) {
			sharedIntegerAssert({
				caller,
				max: sharedTimerMaxMs,
				min: 1,
				name: `${scope}${name}`,
				value,
			});
		}
	}
};

// POST and PATCH are never retried: without an Idempotency-Key a retry could apply them twice.
const methodsRetried = ["get", "head", "delete"];
const statusesRetried = [408, 429, 500, 502, 503, 504];

const dataRead = (text: string, headers: Headers): unknown => {
	if (text === "") return undefined;
	return headers.get("content-type")?.includes("json")
		? (JSON.parse(text) as unknown)
		: text;
};

const timeoutError = (): DOMException =>
	new DOMException("The SDK call timed out", "TimeoutError");

/**
 * Builds one instance of the fetch a generated SDK calls, from its environments (name to API
 * origin) and default options. With no environments, only `baseUrl` sends a call, as the CLI's
 * own login does. Throws a `TypeError` on a bad `retry`, `timeoutMs` or `totalTimeoutMs`.
 */
export const sdkFetchCreate = <E extends string = never>(
	options?: SdkFetchOptions<E> | null,
): SdkFetch<E> => {
	optionsCheck({
		caller: "sdkFetchCreate",
		options: options?.defaults ?? {},
		scope: "defaults.",
	});
	let configured: SdkOptions<E> = { ...options?.defaults };
	const environments: Partial<Record<string, string>> = {
		...options?.environments,
	};
	const names = Object.keys(environments).join(", ");

	// The call's baseUrl, else its environment, else the configured baseUrl, else the configured one.
	const baseUrlResolve = (options: SdkOptions<E>): string => {
		const environment = options.environment ?? configured.environment;
		const url =
			options.baseUrl ??
			(options.environment == null ? configured.baseUrl : undefined);
		if (url != null) return url;
		if (Object.keys(environments).length === 0) {
			throw new Error("No API URL: call sdkConfigure({ baseUrl }) first");
		}
		if (environment == null) {
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
		call: RequestInit & SdkOptions<E>,
	): Promise<T> => {
		optionsCheck({ caller: "sdkFetch", options: call });
		const baseUrl = baseUrlResolve(call);
		const {
			baseUrl: _baseUrl,
			environment: _environment,
			retry: callRetry,
			timeoutMs: callTimeoutMs,
			token: callToken,
			totalTimeoutMs: callTotalTimeoutMs,
			...init
		} = call;
		const retry = callRetry ?? configured.retry ?? 2;
		const timeoutMs = callTimeoutMs ?? configured.timeoutMs ?? 10_000;
		const token = callToken ?? configured.token;
		const totalTimeoutMs =
			callTotalTimeoutMs ?? configured.totalTimeoutMs ?? 30_000;
		const headers = new Headers(init.headers);
		if (token != null) headers.set("authorization", `Bearer ${token}`);
		const method = (init.method ?? "GET").toLowerCase();
		// Bounds the body read too, which ky's own totalTimeout does not cover once it returns.
		const totalSignal = AbortSignal.timeout(totalTimeoutMs);
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
					// 0 for POST and PATCH, so ky does not copy a body it will never send again.
					limit: methodsRetried.includes(method) ? retry : 0,
					methods: methodsRetried,
					retryOnTimeout: true,
					statusCodes: statusesRetried,
				},
				signal,
				// Only a retryable status throws inside ky, so it can retry; the catch maps it back.
				throwHttpErrors: (status) => statusesRetried.includes(status),
				timeout: timeoutMs,
				totalTimeout: totalTimeoutMs,
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
		sdkConfigure: (update) => {
			optionsCheck({ caller: "sdkConfigure", options: update });
			configured = { ...configured, ...update };
		},
		sdkFetch,
	};
};
