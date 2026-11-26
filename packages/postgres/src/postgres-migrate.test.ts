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

	it.each([0, -1, 1.5, 2_147_483_648])(
		"refuses lockWaitMs %s",
		async (lockWaitMs) => {
			await expect(
				postgresMigrate({
					databaseUrl: "postgres://localhost/db",
					lockWaitMs,
					migrationsFolder,
				}),
			).rejects.toThrow(
				new TypeError(
					`postgresMigrate: lockWaitMs must be a whole number from 1 to 2147483647, found ${lockWaitMs}`,
				),
			);
		},
	);

	it.each([0, -1, 1.5, 2_147_483_648])(
		"refuses connectTimeoutMs %s",
		async (connectTimeoutMs) => {
			await expect(
				postgresMigrate({
					connectTimeoutMs,
					databaseUrl: "postgres://localhost/db",
					migrationsFolder,
				}),
			).rejects.toThrow(
				new TypeError(
					`postgresMigrate: connectTimeoutMs must be a whole number from 1 to 2147483647, found ${connectTimeoutMs}`,
				),
			);
		},
	);

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
