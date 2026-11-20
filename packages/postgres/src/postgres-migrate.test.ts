import { describe, expect, it } from "vitest";
import { postgresMigrate } from "./index.ts";

const migrationsFolder = "./migrations";

// Option checks that fail before any connection, so these run without Docker.
describe("postgresMigrate", () => {
	it("refuses a URL that is not postgres:// or postgresql://", async () => {
		await expect(
			postgresMigrate({ databaseUrl: "memory://", migrationsFolder }),
		).rejects.toThrow(
			new TypeError(
				'postgresMigrate: databaseUrl must start with postgres:// or postgresql://, found "memory://"',
			),
		);
	});

	it.each([0, -1, 1.5])("refuses lockWaitMs %s", async (lockWaitMs) => {
		await expect(
			postgresMigrate({
				databaseUrl: "postgres://localhost/db",
				lockWaitMs,
				migrationsFolder,
			}),
		).rejects.toThrow(
			new TypeError("postgresMigrate: lockWaitMs must be a positive integer"),
		);
	});

	it("refuses vendor.ssl when the URL sets TLS, since pg lets the URL win", async () => {
		await expect(
			postgresMigrate({
				databaseUrl: "postgres://localhost/db?sslmode=require",
				migrationsFolder,
				vendor: { ssl: true },
			}),
		).rejects.toThrow(
			new TypeError(
				"postgresMigrate: vendor.ssl is not allowed with sslmode in databaseUrl: pg lets the URL win; set TLS in one place",
			),
		);
	});
});
