// Pool and migrate accept only Postgres URLs; the composition root handles memory:// first.
// The message names the scheme but never the URL, which may hold a password.
export const postgresUrlAssert = (databaseUrl: string): void => {
	if (/^postgres(ql)?:\/\//.test(databaseUrl)) {
		return;
	}
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(databaseUrl)?.[1];
	const found = scheme ? `"${scheme}://"` : "no scheme";
	throw new TypeError(
		`Invalid database URL: found ${found}; use postgres:// or postgresql://`,
	);
};
