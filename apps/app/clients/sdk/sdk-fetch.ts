// The fetch every generated function in sdk.ts calls, made once for this SDK from the Project's
// environments (clients/environments.json). A caller picks one with sdkConfigure({ environment })
// and may override it, the token, timeouts or retries for one call through the function's last
// argument. A function resolves to `{ status, data, headers }` for every status the document
// declares, typed by status: it never throws on an HTTP error, only when no response came.
import { type SdkOptions as Options, sdkFetchCreate } from "@n8io/baseline-sdk";
import environments from "../environments.json" with { type: "json" };

export type SdkOptions = Options<keyof typeof environments>;

const sdk = sdkFetchCreate({ environments });

// Typed in full: the published SDK's declarations are written without type checking.
export const sdkConfigure: (options: SdkOptions) => void = sdk.sdkConfigure;

// An arrow function, not sdk.sdkFetch itself: orval reads the mutator's parameters from its source.
export const sdkFetch = <T>(
	url: string,
	options: RequestInit & SdkOptions,
): Promise<T> => sdk.sdkFetch<T>(url, options);
