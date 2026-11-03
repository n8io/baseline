import { ENV } from "varlock/env";

// development and test may use memory adapters and committed values; production never does.
export const envLocal = ENV.APP_ENV === "development" || ENV.APP_ENV === "test";

// The one rule varlock can't express: memory:// only where envLocal is true.
const memoryNames = ["DATABASE_URL", "CACHE_URL", "AUTHN_ISSUER_URL"] as const;
const memoryRefused = envLocal
	? []
	: memoryNames.filter((name) => ENV[name] === "memory://");
if (memoryRefused.length > 0) {
	throw new Error(
		`memory:// is allowed only in development and test: ${memoryRefused.join(", ")}`,
	);
}

export { ENV };
