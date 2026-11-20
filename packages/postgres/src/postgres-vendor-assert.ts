// The pg settings a `vendor` option may not carry, and the named option that sets each. pg lets
// the URL win over these, so passing one would do nothing, silently.
const postgresVendorOwnedKeys = {
	connectionString: "databaseUrl",
	connectionTimeoutMillis: "connectTimeoutMs",
	database: "databaseUrl",
	host: "databaseUrl",
	password: "databaseUrl",
	port: "databaseUrl",
	user: "databaseUrl",
} as const;

/** The pg settings no `vendor` option may carry. */
export type PostgresVendorOwnedKey = keyof typeof postgresVendorOwnedKeys;

const postgresUrlSslParams = [
	"ssl",
	"sslcert",
	"sslkey",
	"sslmode",
	"sslrootcert",
];

/**
 * Throws on a vendor setting that a named option or the URL already decides. `caller` is the
 * public function that was handed `vendor`, which the message starts with.
 */
export const postgresVendorAssert = ({
	caller,
	databaseUrl,
	owned,
	vendor,
}: {
	caller: string;
	databaseUrl: string;
	owned?: Record<string, string> | null;
	vendor: object;
}): void => {
	for (const [key, option] of Object.entries({
		...postgresVendorOwnedKeys,
		...owned,
	})) {
		if (key in vendor) {
			throw new TypeError(
				`${caller}: vendor.${key} is not allowed: set it with ${option} instead`,
			);
		}
	}
	const urlParams = new URL(databaseUrl).searchParams;
	const sslParam = postgresUrlSslParams.find((name) => urlParams.has(name));
	if ("ssl" in vendor && sslParam !== undefined) {
		throw new TypeError(
			`${caller}: vendor.ssl is not allowed with ${sslParam} in databaseUrl: pg lets the URL win; set TLS in one place`,
		);
	}
};
