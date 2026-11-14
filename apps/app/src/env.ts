import { ENV } from "varlock/env";

// development and test may use memory adapters and committed values; production never does.
const appEnvLocalIs = (appEnv: string | undefined): boolean =>
	appEnv === "development" || appEnv === "test";
export const envLocal = appEnvLocalIs(ENV.APP_ENV);

// The one rule varlock can't express: memory:// only where APP_ENV is development or test.
const memoryNames = [
	"DATABASE_URL",
	// piece-start: redis
	"CACHE_URL",
	// piece-end: redis
	"AUTHN_ISSUER_URL",
] as const;

// The names that hold memory:// where that is refused.
export const envMemoryRefused = (
	env: Partial<Record<(typeof memoryNames)[number] | "APP_ENV", string>>,
): string[] =>
	appEnvLocalIs(env.APP_ENV)
		? []
		: memoryNames.filter((name) => env[name] === "memory://");

const memoryRefused = envMemoryRefused(ENV);
if (memoryRefused.length > 0) {
	throw new Error(
		`memory:// is allowed only in development and test: ${memoryRefused.join(", ")}`,
	);
}

export { ENV };
