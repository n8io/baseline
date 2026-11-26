import {
	sharedConnectionSslAssert,
	sharedConnectionUrlAssert,
} from "@n8io/baseline-shared";

// The `vendor` keys queueMigrate and queueSchedulesSync pass to the connection pg-boss opens.
// Every other key either sets what `databaseUrl` and the queue already set or does nothing.
const queueConnectionVendorKeys = new Set([
	"application_name",
	"options",
	"ssl",
]);

/**
 * Checks what queueMigrate and queueSchedulesSync are handed before pg-boss opens its own
 * connection: a Postgres URL (the entry point handles memory:// first), only the `vendor`
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
	sharedConnectionUrlAssert(databaseUrl, caller);
	for (const key of Object.keys(vendor)) {
		if (!queueConnectionVendorKeys.has(key)) {
			throw new TypeError(
				`${caller}: vendor.${key} is not allowed: only ${[...queueConnectionVendorKeys].join(", ")} reach the connection`,
			);
		}
	}
	sharedConnectionSslAssert({ caller, databaseUrl, vendor });
};
