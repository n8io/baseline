import { randomUUID } from "node:crypto";
import { type AddressInfo, connect, createServer, type Socket } from "node:net";
import {
	type PostgresPool,
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

let pgPool: PostgresPool;
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
const commit = async ({
	event,
	eventName,
	outcome = "commit",
}: {
	event: FooCreated;
	eventName: string;
	outcome?: "commit" | "rollback";
}): Promise<void> => {
	const events =
		pulsarEventsCreate(publisher).publisherCreate<Record<string, FooCreated>>(
			pgPool,
		);
	const result = await postgresTransactionRun({
		pgPool,
		work: async () => {
			await events.publish({ data: event, key: event.fooId, name: eventName });
			return outcome === "commit" ? ok(undefined) : err({ type: "rollback" });
		},
	});
	if (result.ok) await events.committed();
};

const received = ({
	eventName,
	queueName,
	run,
}: {
	eventName: string;
	queueName: string;
	run: (
		event: FooCreated,
		inbox: Inbox,
	) => Promise<Result<unknown, { type: string }>>;
}) => queueConsumerCreate({ eventName, queueName, run, schema: fooCreated });

describe("pulsarEventsCreate", () => {
	it("sends a committed Event to each subscribed Consumer and nothing on rollback", async () => {
		const eventName = eventNameCreate();
		const billing: string[] = [];
		const shipping: string[] = [];
		await pulsarEventsCreate(worker).consumersStart([
			received({
				queueName: "billing.foo-created",
				eventName,
				run: async ({ fooId }) => {
					billing.push(fooId);
					return ok(undefined);
				},
			}),
			received({
				queueName: "shipping.foo-created",
				eventName,
				run: async ({ fooId }) => {
					shipping.push(fooId);
					return ok(undefined);
				},
			}),
		]);
		// Sent in this order on one topic, so a leaked rollback would arrive first.
		await commit({
			eventName,
			event: { fooId: "rolled-back" },
			outcome: "rollback",
		});
		await commit({ eventName, event: { fooId: "committed" } });
		await vi.waitFor(
			() => {
				expect(billing).toEqual(["committed"]);
				expect(shipping).toEqual(["committed"]);
			},
			{ timeout: 20_000 },
		);
	});

	it("tries a Consumer that throws five times while its key waits, then moves the Event to <queueName>.dead and the key moves on", async () => {
		const eventName = eventNameCreate();
		const queueName = `billing.foo-created-${randomUUID()}`;
		const eventIds: string[] = [];
		const runs: string[] = [];
		await pulsarEventsCreate(worker).consumersStart([
			received({
				queueName,
				eventName,
				run: async ({ fooId }, inbox) => {
					runs.push(fooId);
					if (fooId !== "poison") return ok(undefined);
					eventIds.push(inbox.eventId);
					throw new Error("Invoice service down");
				},
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
			const events =
				pulsarEventsCreate(publisher).publisherCreate<
					Record<string, FooCreated>
				>(pgPool);
			for (const [fooId, key] of [
				["poison", "foo_1"],
				["after-poison", "foo_1"],
				["other-key", "foo_2"],
			] as const) {
				await events.publish({ data: { fooId }, key, name: eventName });
			}
			await events.committed();
			const dead = await reader.subscribe({
				subscription: queueName,
				subscriptionType: "Shared",
				topic: `persistent://public/default/${queueName}.dead`,
			});
			const message = await dead.receive(20_000);
			expect(JSON.parse(message.getData().toString())).toEqual({
				fooId: "poison",
			});
			expect(message.getPartitionKey()).toBe("foo_1");
			// Five attempts, as with the queue package, under one event id that the dead letter keeps.
			expect(eventIds).toHaveLength(5);
			expect(new Set(eventIds).size).toBe(1);
			expect(message.getProperties()["event-id"]).toBe(eventIds[0]);
			await vi.waitFor(() => expect(runs).toHaveLength(7), { timeout: 20_000 });
			// The other key ran while the poison Event was still being tried; its own key waited for it.
			expect(runs.indexOf("other-key")).toBeLessThan(
				runs.lastIndexOf("poison"),
			);
			expect(runs.at(-1)).toBe("after-poison");
		} finally {
			await reader.close();
		}
	});

	it("skips a redelivered Event the inbox has seen", async () => {
		const eventName = eventNameCreate();
		const calls: Inbox[] = [];
		await pulsarEventsCreate(worker).consumersStart([
			received({
				queueName: "billing.foo-created-inbox",
				eventName,
				run: async ({ fooId }, inbox) => {
					calls.push(inbox);
					await postgresTransactionRun({
						pgPool,
						work: async (pgClient) => {
							if (await queueInboxInsert(pgClient, inbox)) {
								await pgClient.query(
									"INSERT INTO invoice (foo_id) VALUES ($1)",
									[fooId],
								);
							}
							return ok(undefined);
						},
					});
					// The first attempt commits, then fails before the broker hears back.
					if (calls.length === 1) throw new Error("Connection lost");
					return ok(undefined);
				},
			}),
		]);
		await commit({ eventName, event: { fooId: "foo_inbox" } });
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
			received({
				queueName: "billing.foo-created-trace",
				eventName,
				run: async () => {
					consumerSpan = trace.getActiveSpan()?.spanContext().traceId;
					return ok(undefined);
				},
			}),
		]);
		const traceId = await trace
			.getTracer("test")
			.startActiveSpan("fooCreate", async (span) => {
				await commit({ eventName, event: { fooId: "foo_trace" } });
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

	it("takes the broker's authentication from vendor in place of token", async () => {
		await using viaVendor = pulsarCreate({
			serviceUrl: inject("pulsarUrl"),
			vendor: {
				authentication: new PulsarClient.AuthenticationToken({
					token: inject("pulsarToken"),
				}),
				operationTimeoutSeconds: 10,
			},
		});
		const consumer = received({
			queueName: "billing.foo-created-vendor-auth",
			eventName: "foo.vendor-auth",
			run: async () => ok(undefined),
		});
		await expect(
			pulsarEventsCreate(viaVendor).consumersSubscribe([consumer]),
		).resolves.toBeUndefined();
	});

	it("refuses a vendor key pulsarCreate sets itself, and token with vendor.authentication", () => {
		expect(() =>
			pulsarCreate({
				serviceUrl: inject("pulsarUrl"),
				vendor: { log: () => undefined } as never,
			}),
		).toThrow(
			new TypeError("vendor.log is not allowed: pulsarCreate sets it itself"),
		);
		expect(() =>
			pulsarCreate({
				serviceUrl: inject("pulsarUrl"),
				token: inject("pulsarToken"),
				vendor: {
					authentication: new PulsarClient.AuthenticationToken({
						token: inject("pulsarToken"),
					}),
				},
			}),
		).toThrow(
			new TypeError(
				"Pass token or vendor.authentication to pulsarCreate, not both",
			),
		);
	});

	it("passes the token to the broker, which refuses a client without one", async () => {
		const consumer = received({
			queueName: "billing.foo-created-auth",
			eventName: "foo.auth",
			run: async () => ok(undefined),
		});
		await expect(
			pulsarEventsCreate(worker).consumersSubscribe([consumer]),
		).resolves.toBeUndefined();
		await using anonymous = pulsarCreate({ serviceUrl: inject("pulsarUrl") });
		await expect(
			pulsarEventsCreate(anonymous).consumersSubscribe([consumer]),
		).rejects.toThrow();
	});

	it("await using closes it when its block ends", async () => {
		const clientClose = vi.spyOn(PulsarClient.Client.prototype, "close");
		try {
			{
				await using _pulsar = pulsarCreate({
					serviceUrl: inject("pulsarUrl"),
					token: inject("pulsarToken"),
				});
			}
			expect(clientClose).toHaveBeenCalledOnce();
		} finally {
			clientClose.mockRestore();
		}
	});

	it("refuses an Event without a key", async () => {
		const events =
			pulsarEventsCreate(publisher).publisherCreate<Record<string, FooCreated>>(
				pgPool,
			);
		await expect(
			events.publish({
				data: { fooId: "foo_1" },
				key: "",
				name: "foo.created",
			}),
		).rejects.toThrow(new TypeError("Event foo.created needs a key"));
	});

	it("stays alive while the broker cannot be reached, and carries on when it is back", async () => {
		const broker = new URL(inject("pulsarUrl"));
		const sockets = new Set<Socket>();
		// The way to the broker, so the test can cut it and bring it back.
		const proxy = createServer((near) => {
			const far = connect(Number(broker.port), broker.hostname);
			for (const [socket, other] of [
				[near, far],
				[far, near],
			] as const) {
				sockets.add(socket);
				socket.pipe(other);
				socket.on("error", () => other.destroy());
				socket.on("close", () => {
					sockets.delete(socket);
					other.destroy();
				});
			}
		});
		await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
		const { port } = proxy.address() as AddressInfo;
		const eventName = eventNameCreate();
		const runs: string[] = [];
		const realNow = Date.now.bind(Date);
		const now = vi.spyOn(Date, "now");
		await using viaProxy = pulsarCreate({
			serviceUrl: `pulsar://127.0.0.1:${port}`,
			token: inject("pulsarToken"),
		});
		try {
			await pulsarEventsCreate(viaProxy).consumersStart([
				received({
					queueName: `billing.foo-created-${randomUUID()}`,
					eventName,
					run: async ({ fooId }) => {
						runs.push(fooId);
						return ok(undefined);
					},
				}),
			]);
			expect(viaProxy.isAlive()).toBe(true);
			await new Promise<void>((resolve) => {
				proxy.close(() => resolve());
				for (const socket of sockets) socket.destroy();
			});
			// More than the 60 s limit later the loop is still coming round, so it is alive again
			// within one receive wait.
			const start = realNow();
			now.mockImplementation(() => start + 61_000 + (realNow() - start));
			expect(viaProxy.isAlive()).toBe(false);
			await vi.waitFor(() => expect(viaProxy.isAlive()).toBe(true), {
				timeout: 5_000,
			});
			now.mockRestore();
			await new Promise<void>((resolve) =>
				proxy.listen(port, "127.0.0.1", resolve),
			);
			await commit({ eventName, event: { fooId: "foo_after_outage" } });
			await vi.waitFor(() => expect(runs).toEqual(["foo_after_outage"]), {
				timeout: 30_000,
			});
		} finally {
			now.mockRestore();
			proxy.close();
			for (const socket of sockets) socket.destroy();
		}
	});

	it("reports not alive once a receive loop has not come round for 60 s", async () => {
		// A receive that never returns: the loop is stuck.
		const subscribe = PulsarClient.Client.prototype.subscribe;
		const batchReceive = vi
			.spyOn(PulsarClient.Client.prototype, "subscribe")
			.mockImplementation(async function (this: PulsarClient.Client, config) {
				const subscribed = await subscribe.call(this, config);
				Object.defineProperty(subscribed, "batchReceive", {
					value: () => new Promise(() => undefined),
				});
				return subscribed;
			});
		const now = vi.spyOn(Date, "now");
		await using stuck = pulsarCreate({
			serviceUrl: inject("pulsarUrl"),
			token: inject("pulsarToken"),
		});
		try {
			await pulsarEventsCreate(stuck).consumersStart([
				received({
					queueName: `billing.foo-created-${randomUUID()}`,
					eventName: eventNameCreate(),
					run: async () => ok(undefined),
				}),
			]);
			batchReceive.mockRestore();
			const start = Date.now();
			now.mockReturnValue(start + 59_000);
			expect(stuck.isAlive()).toBe(true);
			now.mockReturnValue(start + 61_000);
			expect(stuck.isAlive()).toBe(false);
		} finally {
			batchReceive.mockRestore();
			now.mockRestore();
		}
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
			received({
				queueName,
				eventName,
				run: async ({ fooId }) => {
					runs.push(fooId);
					await released;
					return ok(undefined);
				},
			}),
		]);
		await commit({ eventName, event: { fooId: "foo_stop" } });
		await vi.waitFor(() => expect(runs).toEqual(["foo_stop"]), {
			timeout: 20_000,
		});
		const stopped = stopping.stop();
		release();
		await stopped;
		await stopping.close();
		// An Event acknowledged before the close is not redelivered to the next worker.
		await using next = pulsarCreate(options);
		await pulsarEventsCreate(next).consumersStart([
			received({
				queueName,
				eventName,
				run: async ({ fooId }) => {
					runs.push(fooId);
					return ok(undefined);
				},
			}),
		]);
		await new Promise((resolve) => setTimeout(resolve, 3_000));
		expect(runs).toEqual(["foo_stop"]);
	});

	it("sends after stop until close, then counts each Event it loses", async () => {
		const eventName = eventNameCreate();
		const runs: string[] = [];
		await pulsarEventsCreate(worker).consumersStart([
			received({
				queueName: `billing.foo-created-${randomUUID()}`,
				eventName,
				run: async ({ fooId }) => {
					runs.push(fooId);
					return ok(undefined);
				},
			}),
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
		await sent.publish({
			data: { fooId: "foo_after_stop" },
			key: "foo_after_stop",
			name: eventName,
		});
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
		await lost.publish({
			data: { fooId: "foo_after_close" },
			key: "foo_after_close",
			name: eventName,
		});
		await expect(lost.committed()).resolves.toBeUndefined();
		expect(eventsLost).toHaveBeenCalledExactlyOnceWith(1, {
			"messaging.destination.name": `persistent://public/default/${eventName}`,
		});
	});

	it("tries a failed producer create again on the next send", async () => {
		const eventName = eventNameCreate();
		const runs: string[] = [];
		await pulsarEventsCreate(worker).consumersStart([
			received({
				queueName: `billing.foo-created-${randomUUID()}`,
				eventName,
				run: async ({ fooId }) => {
					runs.push(fooId);
					return ok(undefined);
				},
			}),
		]);
		const createProducer = vi
			.spyOn(PulsarClient.Client.prototype, "createProducer")
			.mockRejectedValueOnce(new Error("Broker unavailable"));
		await using sender = pulsarCreate({
			serviceUrl: inject("pulsarUrl"),
			token: inject("pulsarToken"),
		});
		eventsLost.mockClear();
		try {
			const first =
				pulsarEventsCreate(sender).publisherCreate<Record<string, FooCreated>>(
					pgPool,
				);
			await first.publish({
				data: { fooId: "foo_lost" },
				key: "foo_lost",
				name: eventName,
			});
			await first.committed();
			expect(eventsLost).toHaveBeenCalledOnce();
			const second =
				pulsarEventsCreate(sender).publisherCreate<Record<string, FooCreated>>(
					pgPool,
				);
			await second.publish({
				data: { fooId: "foo_retried" },
				key: "foo_retried",
				name: eventName,
			});
			await second.committed();
			await vi.waitFor(() => expect(runs).toEqual(["foo_retried"]), {
				timeout: 20_000,
			});
			expect(createProducer).toHaveBeenCalledTimes(2);
			expect(eventsLost).toHaveBeenCalledOnce();
		} finally {
			createProducer.mockRestore();
		}
	});
});
