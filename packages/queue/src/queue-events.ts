import { type Queue, queueBossGet } from "./queue.ts";
import {
	type Consumer,
	queueConsumersStart,
	queueConsumersSubscribe,
} from "./queue-consumer.ts";
import type { QueueSql } from "./queue-sql.ts";

// What a Use case publishes Events through inside its transaction. One per transaction.
export type EventsPublisher<M> = {
	publish<K extends keyof M & string>(name: K, data: M[K]): Promise<void>;
	// Call it once the transaction has committed; on a rollback, drop the publisher instead. A
	// transport that cannot write in the transaction sends what publish buffered here.
	committed(): Promise<void>;
};

// How Events travel between Domains. A composition root opens one (queueEventsCreate, or another
// package's adapter) and nothing else names the transport.
export type Events = {
	// false once the transport has been unable to deliver for too long; report it on /livez.
	isAlive(): boolean;
	// Every instance that may publish calls this at boot, so no Event is sent before its Consumers
	// are known. Safe to repeat on any number of instances.
	consumersSubscribe(consumers: Consumer[]): Promise<void>;
	// Subscribes, then starts running the Consumers (worker process only).
	consumersStart(consumers: Consumer[]): Promise<void>;
	// `transaction` is the open transaction's client.
	publisherCreate<M extends Record<string, unknown>>(
		transaction: QueueSql,
	): EventsPublisher<M>;
};

// Events on the queue. Each publish writes its jobs on the transaction's client, so they commit or
// roll back with the rows (outbox). The queue's own publish reads the subscriptions through the
// pool, which would hold a second connection per transaction; here they are read on the
// transaction's client, and each subscribed queue gets its job one send at a time (one client runs
// one query at a time).
export const queueEventsCreate = (queue: Queue): Events => {
	const boss = queueBossGet(queue);
	return {
		consumersStart: (consumers) => queueConsumersStart(queue, consumers),
		consumersSubscribe: (consumers) =>
			queueConsumersSubscribe(queue, consumers),
		isAlive: () => queue.isAlive(),
		publisherCreate: (transaction) => {
			const db = {
				executeSql: (text: string, values?: unknown[]) =>
					transaction.query(text, values),
			};
			return {
				// The jobs are already in the transaction.
				committed: async () => undefined,
				publish: async (name, data) => {
					const subscribed = await transaction.query(
						"SELECT name FROM queue.subscription WHERE event = $1 ORDER BY name",
						[name],
					);
					for (const { name: queueName } of subscribed.rows as {
						name: string;
					}[]) {
						await boss.send(queueName, data as object, { db });
					}
				},
			};
		},
	};
};

// Records publishes in `published` and delivers nothing; unit tests assert on the array.
export const queueEventsMemoryCreate = <M extends Record<string, unknown>>(
	published: { name: keyof M; data: unknown }[] = [],
): EventsPublisher<M> => ({
	committed: async () => undefined,
	publish: async (name, data) => {
		published.push({ data, name });
	},
});
