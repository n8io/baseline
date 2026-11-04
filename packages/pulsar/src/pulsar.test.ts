import { randomUUID } from "node:crypto";
import {
	postgresPoolCreate,
	postgresTransaction,
} from "@n8io/baseline-postgres";
import {
	consumerCreate,
	type Inbox,
	queueInboxInsert,
	queueMigrate,
} from "@n8io/baseline-queue";
import { err, ok, type Result } from "@n8io/baseline-result";
import { context, SpanKind, trace } from "@opentelemetry/api";
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
import {
	type Pulsar,
	pulsarConsumersStart,
	pulsarConsumersSubscribe,
	pulsarCreate,
	pulsarEvents,
} from "./index.ts";

const spans = new InMemorySpanExporter();
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
trace.setGlobalTracerProvider(
	new TracerProvider({
		spanProcessors: [new SimpleSpanProcessor({ exporter: spans })],
	}),
);

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

// What a project's transaction SPI does: publish buffers in the transaction, send runs on commit.
const commit = async (
	eventName: string,
	event: FooCreated,
	outcome: "commit" | "rollback" = "commit",
): Promise<void> => {
	const events = pulsarEvents<Record<string, FooCreated>>(publisher);
	const result = await postgresTransaction(pgPool, async () => {
		await events.publish(eventName, event);
		return outcome === "commit" ? ok(undefined) : err({ type: "rollback" });
	});
	if (result.ok) await events.send();
};

const received = (
	queueName: string,
	eventName: string,
	run: (
		event: FooCreated,
		inbox: Inbox,
	) => Promise<Result<unknown, { type: string }>>,
) => consumerCreate(queueName, eventName, fooCreated, run);

describe("pulsarEvents and pulsarConsumersStart", () => {
	it("sends a committed Event to each subscribed Consumer and nothing on rollback", async () => {
		const eventName = eventNameCreate();
		const billing: string[] = [];
		const shipping: string[] = [];
		await pulsarConsumersStart(worker, [
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
		await pulsarConsumersStart(worker, [
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
		await pulsarConsumersStart(worker, [
			received(
				"billing.foo-created-inbox",
				eventName,
				async ({ fooId }, inbox) => {
					calls.push(inbox);
					await postgresTransaction(pgPool, async (pgClient) => {
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
		await pulsarConsumersStart(worker, [
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
			pulsarConsumersSubscribe(worker, [consumer]),
		).resolves.toBeUndefined();
		const anonymous = pulsarCreate({ serviceUrl: inject("pulsarUrl") });
		try {
			await expect(
				pulsarConsumersSubscribe(anonymous, [consumer]),
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
		await pulsarConsumersStart(stopping, [
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
			await pulsarConsumersStart(next, [
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
});
