const urlSslParams = ["ssl", "sslcert", "sslkey", "sslmode", "sslrootcert"];

/**
 * Throws unless `databaseUrl` is a Postgres URL. The message names the scheme but never the URL,
 * which may hold a password. `caller` is the public function that was handed the URL.
 */
export const sharedConnectionUrlAssert = (
	databaseUrl: string,
	caller: string,
): void => {
	if (/^postgres(ql)?:\/\//.test(databaseUrl)) return;
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(databaseUrl)?.[1];
	const found = scheme ? `"${scheme}://"` : "no scheme";
	throw new TypeError(
		`${caller}: databaseUrl must start with postgres:// or postgresql://, found ${found}`,
	);
};

/**
 * Throws when `vendor.ssl` and an `ssl*` URL parameter both set TLS. pg lets the URL win, so the
 * vendor value would do nothing, silently. Also throws on a URL that does not parse, without
 * echoing it: Node's own error would carry the password.
 */
export const sharedConnectionSslAssert = ({
	caller,
	databaseUrl,
	vendor,
}: {
	caller: string;
	databaseUrl: string;
	vendor: object;
}): void => {
	let params: URLSearchParams;
	try {
		params = new URL(databaseUrl).searchParams;
	} catch {
		throw new TypeError(`${caller}: databaseUrl is not a valid URL`);
	}
	const sslParam = urlSslParams.find((name) => params.has(name));
	if ("ssl" in vendor && sslParam !== undefined) {
		throw new TypeError(
			`${caller}: vendor.ssl is not allowed with ${sslParam} in databaseUrl: pg lets the URL win; set TLS in one place`,
		);
	}
};
