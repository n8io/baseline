import {
	postgresPoolCreate,
	postgresTransaction,
} from "@n8io/baseline-postgres";
import { err, ok, type Result } from "@n8io/baseline-result";
import { metrics, trace } from "@opentelemetry/api";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
	consumerCreate,
	consumersStart,
	type Inbox,
	type Queue,
	queueCreate,
	queueEventsPgBoss,
	queueInboxInsert,
	queueMigrate,
	queueStop,
} from "../src/index.ts";
import { queueBoss } from "../src/queue-create.ts";
import { queueJobRun } from "../src/queue-job-run.ts";
import { queueTestDatabaseCreate } from "./queue-test-database.ts";

let pgPool: pg.Pool;
let queue: Queue;

beforeAll(async () => {
	const databaseUrl = await queueTestDatabaseCreate();
	await queueMigrate({ databaseUrl });
	pgPool = postgresPoolCreate({ databaseUrl });
	await pgPool.query("CREATE TABLE invoice (foo_id text NOT NULL)");
	queue = await queueCreate({ pgPool, role: "worker" });
});

afterAll(async () => {
	await queueStop(queue);
	await pgPool.end();
});

const fooCreated = z.object({ fooId: z.string() });

const publish = async (data: unknown): Promise<void> => {
	await postgresTransaction(pgPool, async (pgClient) => {
		await queueEventsPgBoss<{ "foo.created": unknown }>(
			queue,
			pgClient,
		).publish("foo.created", data);
		return ok(undefined);
	});
};

describe("consumersStart", () => {
	it("V8: a job keeps its id across retries, and the inbox skips the repeat", async () => {
		const calls: Inbox[] = [];
		// A use case whose first attempt commits, then fails before pg-boss hears back.
		const invoiceCreate = async (
			event: z.infer<typeof fooCreated>,
			inbox: Inbox,
		): Promise<Result<undefined, { type: string }>> => {
			calls.push(inbox);
			const result = await postgresTransaction<undefined, { type: string }>(
				pgPool,
				async (pgClient) => {
					if (!(await queueInboxInsert(pgClient, inbox))) {
						return ok(undefined);
					}
					await pgClient.query("INSERT INTO invoice (foo_id) VALUES ($1)", [
						event.fooId,
					]);
					return ok(undefined);
				},
			);
			if (calls.length === 1) {
				throw new Error("Connection lost after commit");
			}
			return result;
		};
		await consumersStart(queue, [
			consumerCreate(
				"billing.foo-created",
				"foo.created",
				fooCreated,
				invoiceCreate,
			),
		]);

		await publish({ fooId: "foo_1" });
		await vi.waitFor(
			async () => {
				const [job] = await queueBoss(queue).findJobs("billing.foo-created");
				expect(job?.state).toBe("completed");
			},
			{ interval: 250, timeout: 45_000 },
		);

		const [job] = await queueBoss(queue).findJobs("billing.foo-created");
		expect(calls).toEqual([
			{ consumer: "billing.foo-created", eventId: job?.id },
			{ consumer: "billing.foo-created", eventId: job?.id },
		]);
		expect((await pgPool.query("SELECT foo_id FROM invoice")).rows).toEqual([
			{ foo_id: "foo_1" },
		]);
	});

	it("V8: a redriven job keeps its eventId, so redriving twice runs the work once", async () => {
		const calls: Inbox[] = [];
		// Commits, then fails until its third run: dead letter, redrive, dead letter, redrive.
		const invoiceArchive = async (
			event: z.infer<typeof fooCreated>,
			inbox: Inbox,
		): Promise<Result<undefined, { type: string }>> => {
			calls.push(inbox);
			const result = await postgresTransaction<undefined, { type: string }>(
				pgPool,
				async (pgClient) => {
					if (!(await queueInboxInsert(pgClient, inbox))) {
						return ok(undefined);
					}
					await pgClient.query("INSERT INTO invoice (foo_id) VALUES ($1)", [
						event.fooId,
					]);
					return ok(undefined);
				},
			);
			if (calls.length < 3) {
				throw new Error("Connection lost after commit");
			}
			return result;
		};
		await consumersStart(queue, [
			consumerCreate(
				"billing.foo-archived",
				"foo.archived",
				fooCreated,
				invoiceArchive,
			),
		]);
		const boss = queueBoss(queue);
		// No retries, so each failure goes straight to the dead-letter queue.
		await boss.updateQueue("billing.foo-archived", { retryLimit: 0 });
		const deadLettered = async (): Promise<void> => {
			await vi.waitFor(
				async () => {
					const dead = await boss.findJobs("billing.foo-archived.dead");
					expect(dead).toHaveLength(1);
				},
				{ interval: 250, timeout: 30_000 },
			);
		};

		await postgresTransaction(pgPool, async (pgClient) => {
			await queueEventsPgBoss<{ "foo.archived": unknown }>(
				queue,
				pgClient,
			).publish("foo.archived", { fooId: "foo_2" });
			return ok(undefined);
		});
		await deadLettered();
		expect(await boss.redrive("billing.foo-archived.dead")).toBe(1);
		await deadLettered();
		expect(await boss.redrive("billing.foo-archived.dead")).toBe(1);
		await vi.waitFor(
			async () => {
				const jobs = await boss.findJobs("billing.foo-archived");
				expect(jobs.map((job) => job.state)).toContain("completed");
			},
			{ interval: 250, timeout: 30_000 },
		);

		const eventId = calls[0]?.eventId;
		expect(eventId).toBeDefined();
		expect(calls).toEqual([
			{ consumer: "billing.foo-archived", eventId },
			{ consumer: "billing.foo-archived", eventId },
			{ consumer: "billing.foo-archived", eventId },
		]);
		expect(
			(await pgPool.query("SELECT foo_id FROM invoice WHERE foo_id = 'foo_2'"))
				.rows,
		).toEqual([{ foo_id: "foo_2" }]);
	});

	it("fails a job whose data does not match the schema, without echoing it", async () => {
		const run = vi.fn(async () => ok(undefined));
		await consumersStart(queue, [
			consumerCreate("audit.foo-created", "foo.created", fooCreated, run),
		]);

		await publish({ fooId: 42, secret: "hunter2" });
		await vi.waitFor(
			async () => {
				const [job] = await queueBoss(queue).findJobs("audit.foo-created");
				expect(job?.state).toBe("retry");
			},
			{ interval: 250, timeout: 15_000 },
		);

		const [job] = await queueBoss(queue).findJobs("audit.foo-created");
		expect(run).not.toHaveBeenCalled();
		expect(JSON.stringify(job?.output)).toContain(
			"Event failed validation for audit.foo-created",
		);
		expect(JSON.stringify(job?.output)).not.toContain("hunter2");
	});
});

describe("consumerCreate", () => {
	it("parses the event and passes the inbox through", async () => {
		const run = vi.fn(async () => ok("done"));
		const consumer = consumerCreate(
			"billing.foo-created",
			"foo.created",
			fooCreated,
			run,
		);
		const inbox = { consumer: "billing.foo-created", eventId: "job-1" };

		expect(await consumer.run({ extra: 1, fooId: "foo_1" }, inbox)).toEqual(
			ok("done"),
		);
		expect(run).toHaveBeenCalledWith({ fooId: "foo_1" }, inbox);
		expect(consumer).toMatchObject({
			eventName: "foo.created",
			queueName: "billing.foo-created",
		});
	});
});

describe("queueJobRun", () => {
	it("completes on ok", async () => {
		await expect(
			queueJobRun("billing.foo-created", { retryCount: 0 }, async () => ok(1)),
		).resolves.toBeUndefined();
	});

	it("completes on err and marks the span with error.type", async () => {
		const setAttribute = vi.fn();
		vi.spyOn(trace, "getActiveSpan").mockReturnValue({
			setAttribute,
		} as unknown as ReturnType<typeof trace.getActiveSpan>);

		await expect(
			queueJobRun("billing.foo-created", { retryCount: 0 }, async () =>
				err({ type: "FooNotFound" }),
			),
		).resolves.toBeUndefined();
		expect(setAttribute).toHaveBeenCalledWith("error.type", "FooNotFound");
	});

	it("rethrows, and counts a dead letter only on the last attempt", async () => {
		const add = vi.fn();
		vi.spyOn(metrics, "getMeter").mockReturnValue({
			createCounter: () => ({ add }),
		} as unknown as ReturnType<typeof metrics.getMeter>);
		const boom = async (): Promise<never> => {
			throw new Error("boom");
		};

		await expect(
			queueJobRun("billing.foo-created", { retryCount: 3 }, boom),
		).rejects.toThrow("boom");
		expect(add).not.toHaveBeenCalled();
		await expect(
			queueJobRun("billing.foo-created", { retryCount: 4 }, boom),
		).rejects.toThrow("boom");
		expect(add).toHaveBeenCalledWith(1, {
			"messaging.destination.name": "billing.foo-created",
		});
	});
});
