import { randomUUID } from "node:crypto";
import {
	postgresPoolCreate,
	postgresTransactionRun,
} from "@n8io/baseline-postgres";
import {
	type Inbox,
	queueConsumerCreate,
	queueInboxInsert,
	queueMigrate,
} from "@n8io/baseline-queue";
import { err, ok, type Result } from "@n8io/baseline-result";
import { context, metrics, SpanKind, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
	TracerProvider,
} from "@opentelemetry/sdk-trace";
import type pg from "pg";
import PulsarClient from "pulsar-client";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { z } from "zod";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import { type Pulsar, pulsarCreate, pulsarEventsCreate } from "./index.ts";

const spans = new InMemorySpanExporter();
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
trace.setGlobalTracerProvider(
	new TracerProvider({
		spanProcessors: [new SimpleSpanProcessor({ exporter: spans })],
	}),
);

// The lost-Event counter is taken once per process, so every test shares this one.
const eventsLost = vi.fn();
vi.spyOn(metrics, "getMeter").mockReturnValue({
	createCounter: () => ({ add: eventsLost }),
} as unknown as ReturnType<typeof metrics.getMeter>);

let pgPool: pg.Pool;
let publisher: Pulsar;
let worker: Pulsar;

beforeAll(async () => {
	const databaseUrl = await postgresTestDatabaseCreate();
	await queueMigrate({ databaseUrl });
	pgPool = postgresPoolCreate({ databaseUrl });
	await pgPool.query("CREATE TABLE invoice (foo_id text NOT NULL)");
	const options = {
		retryDelayMs: 50,
		serviceUrl: inject("pulsarUrl"),
		token: inject("pulsarToken"),
	};
	publisher = pulsarCreate(options);
	worker = pulsarCreate(options);
});

afterAll(async () => {
	await publisher.stop();
	await worker.stop();
	await pgPool.end();
});

const fooCreated = z.object({ fooId: z.string() });
type FooCreated = z.infer<typeof fooCreated>;

// A topic per test, so no test sees another's Events.
const eventNameCreate = (): string => `foo.created-${randomUUID()}`;

// What a project's transaction SPI does: publish buffers in the transaction, committed sends.
const commit = async (
	eventName: string,
	event: FooCreated,
	outcome: "commit" | "rollback" = "commit",
): Promise<void> => {
	const events =
		pulsarEventsCreate(publisher).publisherCreate<Record<string, FooCreated>>(
			pgPool,
		);
	const result = await postgresTransactionRun(pgPool, async () => {
		await events.publish(eventName, event);
		return outcome === "commit" ? ok(undefined) : err({ type: "rollback" });
	});
	if (result.ok) await events.committed();
};

const received = (
	queueName: string,
	eventName: string,
	run: (
		event: FooCreated,
		inbox: Inbox,
	) => Promise<Result<unknown, { type: string }>>,
) => queueConsumerCreate(queueName, eventName, fooCreated, run);

describe("pulsarEventsCreate", () => {
	it("sends a committed Event to each subscribed Consumer and nothing on rollback", async () => {
		const eventName = eventNameCreate();
		const billing: string[] = [];
		const shipping: string[] = [];
		await pulsarEventsCreate(worker).consumersStart([
			received("billing.foo-created", eventName, async ({ fooId }) => {
				billing.push(fooId);
				return ok(undefined);
			}),
			received("shipping.foo-created", eventName, async ({ fooId }) => {
				shipping.push(fooId);
				return ok(undefined);
			}),
		]);
		// Sent in this order on one topic, so a leaked rollback would arrive first.
		await commit(eventName, { fooId: "rolled-back" }, "rollback");
		await commit(eventName, { fooId: "committed" });
		await vi.waitFor(
			() => {
				expect(billing).toEqual(["committed"]);
				expect(shipping).toEqual(["committed"]);
			},
			{ timeout: 20_000 },
		);
	});

	it("redelivers a Consumer that throws, then moves the Event to <queueName>.dead", async () => {
		const eventName = eventNameCreate();
		const queueName = `billing.foo-created-${randomUUID()}`;
		const eventIds: string[] = [];
		await pulsarEventsCreate(worker).consumersStart([
			received(queueName, eventName, async (_event, inbox) => {
				eventIds.push(inbox.eventId);
				throw new Error("Invoice service down");
			}),
		]);
		const reader = new PulsarClient.Client({
			authentication: new PulsarClient.AuthenticationToken({
				token: inject("pulsarToken"),
			}),
			log: () => undefined,
			serviceUrl: inject("pulsarUrl"),
		});
		try {
			await commit(eventName, { fooId: "foo_1" });
			const dead = await reader.subscribe({
				subscription: queueName,
				topic: `persistent://public/default/${queueName}.dead`,
			});
			const message = await dead.receive(20_000);
			expect(JSON.parse(message.getData().toString())).toEqual({
				fooId: "foo_1",
			});
			// Five attempts, as with the queue package, under one event id that the dead letter keeps.
			expect(eventIds).toHaveLength(5);
			expect(new Set(eventIds).size).toBe(1);
			expect(message.getProperties()["event-id"]).toBe(eventIds[0]);
		} finally {
			await reader.close();
		}
	});

	it("skips a redelivered Event the inbox has seen", async () => {
		const eventName = eventNameCreate();
		const calls: Inbox[] = [];
		await pulsarEventsCreate(worker).consumersStart([
			received(
				"billing.foo-created-inbox",
				eventName,
				async ({ fooId }, inbox) => {
					calls.push(inbox);
					await postgresTransactionRun(pgPool, async (pgClient) => {
						if (await queueInboxInsert(pgClient, inbox)) {
							await pgClient.query("INSERT INTO invoice (foo_id) VALUES ($1)", [
								fooId,
							]);
						}
						return ok(undefined);
					});
					// The first attempt commits, then fails before the broker hears back.
					if (calls.length === 1) throw new Error("Connection lost");
					return ok(undefined);
				},
			),
		]);
		await commit(eventName, { fooId: "foo_inbox" });
		await vi.waitFor(() => expect(calls).toHaveLength(2), { timeout: 20_000 });
		expect(calls[1]).toEqual(calls[0]);
		const invoices = await pgPool.query(
			"SELECT foo_id FROM invoice WHERE foo_id = 'foo_inbox'",
		);
		expect(invoices.rowCount).toBe(1);
	});

	it("carries the publisher's trace context to the Consumer's span", async () => {
		const eventName = eventNameCreate();
		let consumerSpan: string | undefined;
		await pulsarEventsCreate(worker).consumersStart([
			received("billing.foo-created-trace", eventName, async () => {
				consumerSpan = trace.getActiveSpan()?.spanContext().traceId;
				return ok(undefined);
			}),
		]);
		const traceId = await trace
			.getTracer("test")
			.startActiveSpan("fooCreate", async (span) => {
				await commit(eventName, { fooId: "foo_trace" });
				span.end();
				return span.spanContext().traceId;
			});
		await vi.waitFor(() => expect(consumerSpan).toBe(traceId), {
			timeout: 20_000,
		});
		const finished = spans
			.getFinishedSpans()
			.filter((span) => span.spanContext().traceId === traceId);
		const send = finished.find((span) => span.kind === SpanKind.PRODUCER);
		const process = finished.find((span) => span.kind === SpanKind.CONSUMER);
		expect(send?.name).toBe(`send persistent://public/default/${eventName}`);
		expect(send?.attributes["messaging.system"]).toBe("pulsar");
		expect(process?.parentSpanContext?.spanId).toBe(send?.spanContext().spanId);
		expect(process?.attributes["messaging.destination.subscription.name"]).toBe(
			"billing.foo-created-trace",
		);
	});

	it("passes the token to the broker, which refuses a client without one", async () => {
		const consumer = received(
			"billing.foo-created-auth",
			"foo.auth",
			async () => ok(undefined),
		);
		await expect(
			pulsarEventsCreate(worker).consumersSubscribe([consumer]),
		).resolves.toBeUndefined();
		const anonymous = pulsarCreate({ serviceUrl: inject("pulsarUrl") });
		try {
			await expect(
				pulsarEventsCreate(anonymous).consumersSubscribe([consumer]),
			).rejects.toThrow();
		} finally {
			await anonymous.close();
		}
	});

	it("reports alive while connected", () => {
		expect(worker.isAlive()).toBe(true);
	});

	it("lets a running Consumer finish and acknowledge before stop closes it", async () => {
		const eventName = eventNameCreate();
		const queueName = `billing.foo-created-${randomUUID()}`;
		const options = {
			serviceUrl: inject("pulsarUrl"),
			token: inject("pulsarToken"),
		};
		const stopping = pulsarCreate(options);
		const runs: string[] = [];
		let release = (): void => undefined;
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		await pulsarEventsCreate(stopping).consumersStart([
			received(queueName, eventName, async ({ fooId }) => {
				runs.push(fooId);
				await released;
				return ok(undefined);
			}),
		]);
		await commit(eventName, { fooId: "foo_stop" });
		await vi.waitFor(() => expect(runs).toEqual(["foo_stop"]), {
			timeout: 20_000,
		});
		const stopped = stopping.stop();
		release();
		await stopped;
		await stopping.close();
		// An Event acknowledged before the close is not redelivered to the next worker.
		const next = pulsarCreate(options);
		try {
			await pulsarEventsCreate(next).consumersStart([
				received(queueName, eventName, async ({ fooId }) => {
					runs.push(fooId);
					return ok(undefined);
				}),
			]);
			await new Promise((resolve) => setTimeout(resolve, 3_000));
			expect(runs).toEqual(["foo_stop"]);
		} finally {
			await next.close();
		}
	});

	it("sends after stop until close, then counts each Event it loses", async () => {
		const eventName = eventNameCreate();
		const runs: string[] = [];
		await pulsarEventsCreate(worker).consumersStart([
			received(
				`billing.foo-created-${randomUUID()}`,
				eventName,
				async ({ fooId }) => {
					runs.push(fooId);
					return ok(undefined);
				},
			),
		]);
		const sender = pulsarCreate({
			serviceUrl: inject("pulsarUrl"),
			token: inject("pulsarToken"),
		});
		eventsLost.mockClear();
		await sender.stop();
		const sent =
			pulsarEventsCreate(sender).publisherCreate<Record<string, FooCreated>>(
				pgPool,
			);
		await sent.publish(eventName, { fooId: "foo_after_stop" });
		await sent.committed();
		await vi.waitFor(() => expect(runs).toEqual(["foo_after_stop"]), {
			timeout: 20_000,
		});
		expect(eventsLost).not.toHaveBeenCalled();
		await sender.close();
		// The change is already committed, so send resolves; the Event is only logged and counted.
		const lost =
			pulsarEventsCreate(sender).publisherCreate<Record<string, FooCreated>>(
				pgPool,
			);
		await lost.publish(eventName, { fooId: "foo_after_close" });
		await expect(lost.committed()).resolves.toBeUndefined();
		expect(eventsLost).toHaveBeenCalledExactlyOnceWith(1, {
			"messaging.destination.name": `persistent://public/default/${eventName}`,
		});
	});

	it("tries a failed producer create again on the next send", async () => {
		const eventName = eventNameCreate();
		const runs: string[] = [];
		await pulsarEventsCreate(worker).consumersStart([
			received(
				`billing.foo-created-${randomUUID()}`,
				eventName,
				async ({ fooId }) => {
					runs.push(fooId);
					return ok(undefined);
				},
			),
		]);
		const createProducer = vi
			.spyOn(PulsarClient.Client.prototype, "createProducer")
			.mockRejectedValueOnce(new Error("Broker unavailable"));
		const sender = pulsarCreate({
			serviceUrl: inject("pulsarUrl"),
			token: inject("pulsarToken"),
		});
		eventsLost.mockClear();
		try {
			const first =
				pulsarEventsCreate(sender).publisherCreate<Record<string, FooCreated>>(
					pgPool,
				);
			await first.publish(eventName, { fooId: "foo_lost" });
			await first.committed();
			expect(eventsLost).toHaveBeenCalledOnce();
			const second =
				pulsarEventsCreate(sender).publisherCreate<Record<string, FooCreated>>(
					pgPool,
				);
			await second.publish(eventName, { fooId: "foo_retried" });
			await second.committed();
			await vi.waitFor(() => expect(runs).toEqual(["foo_retried"]), {
				timeout: 20_000,
			});
			expect(createProducer).toHaveBeenCalledTimes(2);
			expect(eventsLost).toHaveBeenCalledOnce();
		} finally {
			createProducer.mockRestore();
			await sender.close();
		}
	});
});
