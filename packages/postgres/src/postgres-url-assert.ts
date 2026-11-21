// Copied to packages/queue/src/queue-connection-assert.ts; keep the two in step.
/**
 * Pool and migrate accept only Postgres URLs; the entry point handles memory:// first.
 * The message names the scheme but never the URL, which may hold a password. `caller` is the
 * public function that was handed the URL, which the message starts with.
 */
export const postgresUrlAssert = (
	databaseUrl: string,
	caller: string,
): void => {
	if (/^postgres(ql)?:\/\//.test(databaseUrl)) {
		return;
	}
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(databaseUrl)?.[1];
	const found = scheme ? `"${scheme}://"` : "no scheme";
	throw new TypeError(
		`${caller}: databaseUrl must start with postgres:// or postgresql://, found ${found}`,
	);
};
