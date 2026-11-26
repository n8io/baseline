import { describe, expect, it } from "vitest";
import { queueCreate } from "./index.ts";
import type { QueueSql } from "./queue-sql.ts";

// The checks run before the queue touches its pool, so no Postgres is needed.
const pgPool: QueueSql = {
	query: () => Promise.reject(new Error("the pool is not used")),
};

describe("queueCreate", () => {
	it.each([
		["schema", "queueCreate sets it itself"],
		["supervise", "queueCreate sets it itself"],
		["connectionString", "the queue runs on pgPool; set it on the pool"],
		["ssl", "the queue runs on pgPool; set it on the pool"],
		["createSchema", "it only acts in queueMigrate"],
		["useListenNotify", "the queue does not support it"],
	])("refuses vendor.%s: %s", async (key, reason) => {
		await expect(
			queueCreate({ pgPool, role: "publisher", vendor: { [key]: undefined } }),
		).rejects.toThrow(
			new TypeError(`queueCreate: vendor.${key} is not allowed: ${reason}`),
		);
	});

	it.each(["Worker", "", undefined, null])("refuses role %j", async (role) => {
		await expect(
			queueCreate({ pgPool, role: role as "worker" }),
		).rejects.toThrow(
			new TypeError(
				`queueCreate: role must be "publisher" or "worker", found ${JSON.stringify(role)}`,
			),
		);
	});

	it.each([0, -1, 1.5])("refuses concurrency %s", async (concurrency) => {
		await expect(
			queueCreate({ concurrency, pgPool, role: "worker" }),
		).rejects.toThrow(
			new TypeError(
				`queueCreate: concurrency must be a whole number, 1 or more, found ${concurrency}`,
			),
		);
	});
});
