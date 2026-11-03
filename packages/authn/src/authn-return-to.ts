// Browsers drop tabs and newlines from URLs and read `\` as `/`, so `/\t/evil.example` would
// become `//evil.example`. A safe path starts with one `/` and holds neither.
const isSamePath = (returnTo: string): boolean =>
	returnTo.startsWith("/") &&
	!returnTo.startsWith("//") &&
	![...returnTo].some((char) => char === "\\" || char.charCodeAt(0) < 0x20);

/** Keeps only same-origin paths, so `returnTo` can never send a user to another site. */
export const authnReturnToSafe = (returnTo: string | undefined): string =>
	returnTo !== undefined && isSamePath(returnTo) ? returnTo : "/";

/** The page a request is for, with React Router's `.data` suffix and `_routes` param removed. */
export const authnPagePath = (url: URL): string => {
	const pathname = url.pathname.endsWith("/_.data")
		? url.pathname.replace(/_\.data$/, "")
		: url.pathname.replace(/\.data$/, "");
	const search = new URLSearchParams(url.search);
	search.delete("_routes");
	const query = search.toString();
	return query ? `${pathname}?${query}` : pathname;
};

/** True for React Router's client-side data requests (`/foos.data`). */
export const authnIsDataRequest = (url: URL): boolean =>
	url.pathname.endsWith(".data");

/** The URL the provider sends the user back to; behind a TLS proxy the request arrives as http. */
export const authnPublicUrl = (request: Request, path: string): URL => {
	const url = new URL(path, request.url);
	if (request.headers.get("x-forwarded-proto") === "https") {
		url.protocol = "https:";
	}
	return url;
};
