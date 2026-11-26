import {
	type PostgresPool,
	postgresPoolCreate,
	postgresTransactionRun,
} from "@n8io/baseline-postgres";
import { ok, type Result } from "@n8io/baseline-result";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
	TracerProvider,
} from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import {
	type Inbox,
	type Queue,
	queueConsumerCreate,
	queueCreate,
	queueEventsCreate,
	queueInboxInsert,
	queueMigrate,
} from "./index.ts";
import { queueBossGet } from "./queue.ts";
import { queueWaitFor } from "./queue-wait-for.ts";

// The tests are the caller here.
const bossGet = (queue: Queue) => queueBossGet(queue, "test");

let pgPool: PostgresPool;
let queue: Queue;

// What the telemetry preload registers in every process.
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
trace.setGlobalTracerProvider(
	new TracerProvider({
		spanProcessors: [
			new SimpleSpanProcessor({ exporter: new InMemorySpanExporter() }),
		],
	}),
);

beforeAll(async () => {
	const databaseUrl = await postgresTestDatabaseCreate();
	await queueMigrate({ databaseUrl });
	pgPool = postgresPoolCreate({ databaseUrl });
	await pgPool.query("CREATE TABLE invoice (foo_id text NOT NULL)");
	queue = await queueCreate({ pgPool, role: "worker" });
});

afterAll(async () => {
	await queue.close();
	await pgPool.end();
});

const fooCreated = z.object({ fooId: z.string() });

const publish = async (data: unknown): Promise<void> => {
	await postgresTransactionRun({
		pgPool,
		work: async (pgClient) => {
			await queueEventsCreate(queue)
				.publisherCreate<{ "foo.created": unknown }>(pgClient)
				.publish({ data, key: "foo_1", name: "foo.created" });
			return ok(undefined);
		},
	});
};

describe("consumersStart", () => {
	it("a job keeps its id across retries, and the inbox skips the repeat", async () => {
		const calls: Inbox[] = [];
		// A use case whose first attempt commits, then fails before pg-boss hears back.
		const invoiceCreate = async (
			event: z.infer<typeof fooCreated>,
			inbox: Inbox,
		): Promise<Result<undefined, { type: string }>> => {
			calls.push(inbox);
			const result = await postgresTransactionRun<undefined, { type: string }>({
				pgPool,
				work: async (pgClient) => {
					if (!(await queueInboxInsert(pgClient, inbox))) {
						return ok(undefined);
					}
					await pgClient.query("INSERT INTO invoice (foo_id) VALUES ($1)", [
						event.fooId,
					]);
					return ok(undefined);
				},
			});
			if (calls.length === 1) {
				throw new Error("Connection lost after commit");
			}
			return result;
		};
		await queueEventsCreate(queue).consumersStart([
			queueConsumerCreate({
				queueName: "billing.foo-created",
				eventName: "foo.created",
				schema: fooCreated,
				run: invoiceCreate,
			}),
		]);

		await publish({ fooId: "foo_1" });
		await queueWaitFor(
			async () => {
				const [job] = await bossGet(queue).findJobs(
					"billing.foo-created.ordered",
				);
				expect(job?.state).toBe("completed");
			},
			{ interval: 250, timeout: 45_000 },
		);

		const [job] = await bossGet(queue).findJobs("billing.foo-created.ordered");
		expect(calls).toEqual([
			{ consumer: "billing.foo-created", eventId: job?.id },
			{ consumer: "billing.foo-created", eventId: job?.id },
		]);
		expect((await pgPool.query("SELECT foo_id FROM invoice")).rows).toEqual([
			{ foo_id: "foo_1" },
		]);
	});

	it("a redriven job keeps its eventId, so redriving twice runs the work once", async () => {
		const calls: Inbox[] = [];
		// Commits, then fails until its third run: dead letter, redrive, dead letter, redrive.
		const invoiceArchive = async (
			event: z.infer<typeof fooCreated>,
			inbox: Inbox,
		): Promise<Result<undefined, { type: string }>> => {
			calls.push(inbox);
			const result = await postgresTransactionRun<undefined, { type: string }>({
				pgPool,
				work: async (pgClient) => {
					if (!(await queueInboxInsert(pgClient, inbox))) {
						return ok(undefined);
					}
					await pgClient.query("INSERT INTO invoice (foo_id) VALUES ($1)", [
						event.fooId,
					]);
					return ok(undefined);
				},
			});
			if (calls.length < 3) {
				throw new Error("Connection lost after commit");
			}
			return result;
		};
		await queueEventsCreate(queue).consumersStart([
			queueConsumerCreate({
				queueName: "billing.foo-archived",
				eventName: "foo.archived",
				schema: fooCreated,
				run: invoiceArchive,
			}),
		]);
		const boss = bossGet(queue);
		// No retries, so each failure goes straight to the dead-letter queue.
		await boss.updateQueue("billing.foo-archived.ordered", { retryLimit: 0 });
		// The failed job is discarded, so its key moves on, and its dead-letter copy is redriven.
		const discardedAndRedriven = async (): Promise<void> => {
			await queueWaitFor(
				async () => {
					const dead = await boss.findJobs("billing.foo-archived.dead");
					expect(dead).toHaveLength(1);
				},
				{ interval: 250, timeout: 30_000 },
			);
			await pgPool.query(
				"DELETE FROM queue.job WHERE name = 'billing.foo-archived.ordered' AND state = 'failed'",
			);
			expect(await boss.redrive("billing.foo-archived.dead")).toBe(1);
		};

		await postgresTransactionRun({
			pgPool,
			work: async (pgClient) => {
				await queueEventsCreate(queue)
					.publisherCreate<{ "foo.archived": unknown }>(pgClient)
					.publish({
						data: { fooId: "foo_2" },
						key: "foo_2",
						name: "foo.archived",
					});
				return ok(undefined);
			},
		});
		await discardedAndRedriven();
		await discardedAndRedriven();
		await queueWaitFor(
			async () => {
				const jobs = await boss.findJobs("billing.foo-archived.ordered");
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
		const runCalls: unknown[][] = [];
		const run = async (...args: unknown[]) => {
			runCalls.push(args);
			return ok(undefined);
		};
		await queueEventsCreate(queue).consumersStart([
			queueConsumerCreate({
				queueName: "audit.foo-created",
				eventName: "foo.created",
				schema: fooCreated,
				run,
			}),
		]);

		await publish({ fooId: 42, secret: "hunter2" });
		await queueWaitFor(
			async () => {
				const [job] = await bossGet(queue).findJobs(
					"audit.foo-created.ordered",
				);
				expect(job?.state).toBe("retry");
			},
			{ interval: 250, timeout: 15_000 },
		);

		const [job] = await bossGet(queue).findJobs("audit.foo-created.ordered");
		expect(runCalls).toEqual([]);
		expect(JSON.stringify(job?.output)).toContain(
			"Event failed validation for audit.foo-created",
		);
		expect(JSON.stringify(job?.output)).not.toContain("hunter2");
	});
});

describe("consumersStart trace context", () => {
	it("runs the Consumer in the publishing request's trace", async () => {
		let consumerTraceId: string | undefined;
		await queueEventsCreate(queue).consumersStart([
			queueConsumerCreate({
				queueName: "billing.foo-traced",
				eventName: "foo.traced",
				schema: fooCreated,
				run: async () => {
					consumerTraceId = trace.getActiveSpan()?.spanContext().traceId;
					return ok(undefined);
				},
			}),
		]);

		const publisherTraceId = await trace
			.getTracer("test")
			.startActiveSpan("fooCreate", async (span) => {
				await postgresTransactionRun({
					pgPool,
					work: async (pgClient) => {
						await queueEventsCreate(queue)
							.publisherCreate<{ "foo.traced": unknown }>(pgClient)
							.publish({
								data: { fooId: "foo_3" },
								key: "foo_3",
								name: "foo.traced",
							});
						return ok(undefined);
					},
				});
				span.end();
				return span.spanContext().traceId;
			});

		await queueWaitFor(() => expect(consumerTraceId).toBe(publisherTraceId), {
			interval: 250,
			timeout: 15_000,
		});
	});
});

describe("consumersStart trace context in a batch", () => {
	it("runs each Consumer of one fetch in the trace of its own Event", async () => {
		const events = queueEventsCreate(queue);
		const seen = new Map<string, string | undefined>();
		const consumer = queueConsumerCreate({
			queueName: "billing.foo-batched",
			eventName: "foo.batched",
			schema: fooCreated,
			run: async (event) => {
				seen.set(event.fooId, trace.getActiveSpan()?.spanContext().traceId);
				return ok(undefined);
			},
		});
		await events.consumersSubscribe([consumer]);
		const published = new Map<string, string>();
		for (const fooId of ["foo_4", "foo_5", "foo_6"]) {
			await trace
				.getTracer("test")
				.startActiveSpan("fooCreate", async (span) => {
					await postgresTransactionRun({
						pgPool,
						work: async (pgClient) => {
							await events
								.publisherCreate<{ "foo.batched": unknown }>(pgClient)
								.publish({ data: { fooId }, key: fooId, name: "foo.batched" });
							return ok(undefined);
						},
					});
					span.end();
					published.set(fooId, span.spanContext().traceId);
				});
		}

		// All three wait before the worker starts, so its first fetch takes them together.
		await events.consumersStart([consumer]);

		await queueWaitFor(() => expect(seen).toEqual(published), {
			interval: 250,
			timeout: 15_000,
		});
		expect(new Set(published.values()).size).toBe(3);
	});
});
