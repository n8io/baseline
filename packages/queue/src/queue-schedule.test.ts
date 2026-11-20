import { describe, expect, it } from "vitest";
import { type QueueMigrateVendorOptions, queueSchedulesSync } from "./index.ts";
import { queueScheduleEnvName } from "./queue-schedule.ts";

// Each refusal comes before pg-boss opens its connection, so no Postgres is needed.
describe("queueSchedulesSync", () => {
	it("refuses a URL that is not Postgres", async () => {
		await expect(
			queueSchedulesSync({ databaseUrl: "memory://", env: {}, schedules: [] }),
		).rejects.toThrow(
			new TypeError(
				'queueSchedulesSync: databaseUrl must start with postgres:// or postgresql://, found "memory://"',
			),
		);
	});

	it("refuses a vendor key the connection does not take, as queueMigrate does", async () => {
		await expect(
			queueSchedulesSync({
				databaseUrl: "postgres://localhost/db",
				env: {},
				schedules: [],
				vendor: { max: 1 } as QueueMigrateVendorOptions,
			}),
		).rejects.toThrow(
			new TypeError(
				"queueSchedulesSync: vendor.max is not allowed: only application_name, options, ssl reach the connection",
			),
		);
	});

	it("refuses vendor.ssl when the URL sets TLS, since pg lets the URL win", async () => {
		await expect(
			queueSchedulesSync({
				databaseUrl: "postgres://localhost/db?sslrootcert=/ca.pem",
				env: {},
				schedules: [],
				vendor: { ssl: true },
			}),
		).rejects.toThrow(
			new TypeError(
				"queueSchedulesSync: vendor.ssl is not allowed with sslrootcert in databaseUrl: pg lets the URL win; set TLS in one place",
			),
		);
	});

	it("refuses a databaseUrl that does not parse, without echoing it", async () => {
		await expect(
			queueSchedulesSync({
				databaseUrl: "postgres://user:secret@host:99999/db",
				env: {},
				schedules: [],
			}),
		).rejects.toThrow(
			new TypeError("queueSchedulesSync: databaseUrl is not a valid URL"),
		);
	});
});

describe("queueScheduleEnvName", () => {
	it("uppercases the name and turns . and - into _", () => {
		expect(queueScheduleEnvName("foo.stale-archive")).toBe(
			"SCHEDULE_FOO_STALE_ARCHIVE",
		);
	});
});
