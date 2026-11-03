import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.doUnmock("varlock/env");
	vi.resetModules();
});

const envImport = (env: Record<string, string>) => {
	vi.resetModules();
	vi.doMock("varlock/env", () => ({ ENV: env }));
	return import("../../src/env.ts");
};

const memoryEnv = {
	AUTHN_ISSUER_URL: "memory://",
	CACHE_URL: "memory://",
	DATABASE_URL: "memory://",
};

describe("varlock setup file", () => {
	it("loads .env.test into process.env and ENV in this worker", async () => {
		const { ENV } = await import("../../src/env.ts");
		expect(process.env.APP_ENV).toBe("test");
		expect(process.env.LOG_LEVEL).toBe("silent");
		expect(ENV.DATABASE_URL).toBe("memory://");
		expect(ENV.PORT).toBe(3000);
	});
});

describe("src/env.ts", () => {
	it.each(["development", "test"])("allows memory:// in %s", async (appEnv) => {
		const { envLocal } = await envImport({ ...memoryEnv, APP_ENV: appEnv });
		expect(envLocal).toBe(true);
	});

	it("refuses memory:// in production, naming each item", async () => {
		await expect(
			envImport({
				APP_ENV: "production",
				AUTHN_ISSUER_URL: "https://issuer.example.com",
				CACHE_URL: "memory://",
				DATABASE_URL: "memory://",
			}),
		).rejects.toThrow(
			"memory:// is allowed only in development and test: DATABASE_URL, CACHE_URL",
		);
	});

	it("accepts real URLs in production", async () => {
		const { envLocal } = await envImport({
			APP_ENV: "production",
			AUTHN_ISSUER_URL: "https://issuer.example.com",
			CACHE_URL: "rediss://cache.example.com",
			DATABASE_URL: "postgres://db.example.com/app",
		});
		expect(envLocal).toBe(false);
	});
});
