import { describe, expect, it } from "vitest";
import { type QueueMigrateVendorOptions, queueMigrate } from "./index.ts";

// Each refusal comes before pg-boss opens its connection, so no Postgres is needed.
describe("queueMigrate", () => {
	it("refuses a URL that is not Postgres, without echoing it", async () => {
		await expect(
			queueMigrate({ databaseUrl: "memory://secret@host" }),
		).rejects.toThrow(
			new TypeError(
				'queueMigrate: databaseUrl must start with postgres:// or postgresql://, found "memory://"',
			),
		);
	});

	it.each(["connectionString", "max", "schema"])(
		"refuses vendor.%s, which the connection does not take from vendor",
		async (key) => {
			await expect(
				queueMigrate({
					databaseUrl: "postgres://localhost/db",
					// An untyped caller (JavaScript, or a cast) can still pass it.
					vendor: { [key]: 1 } as QueueMigrateVendorOptions,
				}),
			).rejects.toThrow(
				new TypeError(
					`queueMigrate: vendor.${key} is not allowed: only application_name, options, ssl reach the connection`,
				),
			);
		},
	);

	it("refuses vendor.ssl when the URL sets TLS, since pg lets the URL win", async () => {
		await expect(
			queueMigrate({
				databaseUrl: "postgres://localhost/db?sslmode=require",
				vendor: { ssl: true },
			}),
		).rejects.toThrow(
			new TypeError(
				"queueMigrate: vendor.ssl is not allowed with sslmode in databaseUrl: pg lets the URL win; set TLS in one place",
			),
		);
	});
});
