// The `vendor` keys queueMigrate and queueSchedulesSync pass to the connection pg-boss opens.
// Every other key either sets what `databaseUrl` and the queue already set or does nothing.
const queueConnectionVendorKeys = new Set([
	"application_name",
	"options",
	"ssl",
]);

// Copied from packages/postgres/src/postgres-vendor-assert.ts; keep the two in step.
const queueUrlSslParams = [
	"ssl",
	"sslcert",
	"sslkey",
	"sslmode",
	"sslrootcert",
];

/**
 * Checks what queueMigrate and queueSchedulesSync are handed before pg-boss opens its own
 * connection: a Postgres URL (the composition root handles memory:// first), only the `vendor`
 * keys that connection reads, and TLS set in one place. Each message starts with `caller` and
 * never echoes the URL, which may hold a password.
 */
export const queueConnectionAssert = ({
	caller,
	databaseUrl,
	vendor,
}: {
	caller: string;
	databaseUrl: string;
	vendor: object;
}): void => {
	queueUrlAssert(databaseUrl, caller);
	for (const key of Object.keys(vendor)) {
		if (!queueConnectionVendorKeys.has(key)) {
			throw new TypeError(
				`${caller}: vendor.${key} is not allowed: only ${[...queueConnectionVendorKeys].join(", ")} reach the connection`,
			);
		}
	}
	const urlParams = queueUrlParamsRead(databaseUrl, caller);
	const sslParam = queueUrlSslParams.find((name) => urlParams.has(name));
	if ("ssl" in vendor && sslParam !== undefined) {
		throw new TypeError(
			`${caller}: vendor.ssl is not allowed with ${sslParam} in databaseUrl: pg lets the URL win; set TLS in one place`,
		);
	}
};

// Copied from packages/postgres/src/postgres-vendor-assert.ts; keep the two in step. Node's own
// error would carry the whole URL, password included.
const queueUrlParamsRead = (
	databaseUrl: string,
	caller: string,
): URLSearchParams => {
	try {
		return new URL(databaseUrl).searchParams;
	} catch {
		throw new TypeError(`${caller}: databaseUrl is not a valid URL`);
	}
};

// Copied from packages/postgres/src/postgres-url-assert.ts; keep the two in step.
const queueUrlAssert = (databaseUrl: string, caller: string): void => {
	if (/^postgres(ql)?:\/\//.test(databaseUrl)) {
		return;
	}
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(databaseUrl)?.[1];
	const found = scheme ? `"${scheme}://"` : "no scheme";
	throw new TypeError(
		`${caller}: databaseUrl must start with postgres:// or postgresql://, found ${found}`,
	);
};
