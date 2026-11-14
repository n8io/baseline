import { describe, expect, it } from "vitest";
import { envMemoryRefused } from "./env.ts";

describe("varlock setup file", () => {
	it("loads .env.test into process.env and ENV in this worker", async () => {
		const { ENV } = await import("./env.ts");
		expect(process.env.APP_ENV).toBe("test");
		expect(process.env.LOG_LEVEL).toBe("silent");
		expect(ENV.DATABASE_URL).toBe("memory://");
		expect(ENV.PORT).toBe(3000);
	});
});

describe("envMemoryRefused", () => {
	const memory = {
		AUTHN_ISSUER_URL: "memory://",
		DATABASE_URL: "memory://",
	};

	it.each(["development", "test"])("allows memory:// in %s", (APP_ENV) => {
		expect(envMemoryRefused({ ...memory, APP_ENV })).toEqual([]);
	});

	it("refuses memory:// in production, naming each item", () => {
		expect(envMemoryRefused({ ...memory, APP_ENV: "production" })).toEqual([
			"DATABASE_URL",
			"AUTHN_ISSUER_URL",
		]);
	});

	it("accepts real URLs in production", () => {
		expect(
			envMemoryRefused({
				APP_ENV: "production",
				AUTHN_ISSUER_URL: "https://issuer.example.com",
				DATABASE_URL: "postgres://db.example.com/app",
			}),
		).toEqual([]);
	});
});
