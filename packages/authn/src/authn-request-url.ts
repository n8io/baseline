/** The page a request is for, with React Router's `.data` suffix and `_routes` param removed. */
export const authnRequestUrlPagePath = (url: URL): string => {
	const pathname = url.pathname.endsWith("/_.data")
		? url.pathname.replace(/_\.data$/, "")
		: url.pathname.replace(/\.data$/, "");
	const search = new URLSearchParams(url.search);
	search.delete("_routes");
	const query = search.toString();
	return query ? `${pathname}?${query}` : pathname;
};

/** True for React Router's client-side data requests (`/foos.data`). */
export const authnRequestUrlDataIs = (url: URL): boolean =>
	url.pathname.endsWith(".data");

/** The URL the provider sends the user back to; behind a TLS proxy the request arrives as http. */
export const authnRequestUrlPublic = (request: Request, path: string): URL => {
	const url = new URL(path, request.url);
	if (request.headers.get("x-forwarded-proto") === "https") {
		url.protocol = "https:";
	}
	return url;
};
