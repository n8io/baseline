// The fetch every generated function in sdk.ts calls. A caller sets the API's URL and a bearer
// token once with sdkConfigure, and may override either for one call through the function's last
// argument. A function resolves to `{ status, data, headers }` for every status the document
// declares, typed by status: it never throws on an HTTP error, only when the request fails.

export type SdkOptions = {
	// The API's origin, such as https://api.example.com; operation paths start with /api/v1.
	baseUrl?: string;
	token?: string;
};

let configured: SdkOptions = {};

/** Sets the URL or token (or both) every later call uses unless the call passes its own. */
export const sdkConfigure = (options: SdkOptions): void => {
	configured = { ...configured, ...options };
};

export const sdkFetch = async <T>(
	url: string,
	options: RequestInit & SdkOptions,
): Promise<T> => {
	const {
		baseUrl = configured.baseUrl,
		token = configured.token,
		...init
	} = options;
	if (baseUrl === undefined) {
		throw new Error("No API URL: call sdkConfigure({ baseUrl }) first");
	}
	const headers = new Headers(init.headers);
	if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
	const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${url}`, {
		...init,
		headers,
	});
	const text = await response.text();
	const data =
		text === ""
			? undefined
			: response.headers.get("content-type")?.includes("json")
				? (JSON.parse(text) as unknown)
				: text;
	return { data, headers: response.headers, status: response.status } as T;
};
