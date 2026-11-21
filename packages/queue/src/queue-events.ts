import { type Queue, queueBossGet } from "./queue.ts";
import {
	type Consumer,
	queueConsumersStart,
	queueConsumersSubscribe,
} from "./queue-consumer.ts";
import { queueOrderedName } from "./queue-ordered.ts";
import type { QueueSql } from "./queue-sql.ts";

/** What a Use case publishes Events through inside its transaction. One per transaction. */
export type EventsPublisher<M> = {
	/**
	 * `key` is the Event key: the id of the model the Event is about. Events with the same key reach each Consumer
	 * one at a time, in the order their transactions committed; other keys run beside them.
	 */
	publish<K extends keyof M & string>(event: {
		name: K;
		data: M[K];
		key: string;
	}): Promise<void>;
	/**
	 * Call it once the transaction has committed; on a rollback, drop the publisher instead. A
	 * transport that cannot write in the transaction sends what publish buffered here.
	 */
	committed(): Promise<void>;
};

/**
 * How Events travel between contexts. An entry point opens one (queueEventsCreate) and nothing
 * else names the transport.
 */
export type Events = {
	/**
	 * false only when this process's own receiving loop is stuck, which a restart fixes; report it
	 * on /livez. An outage of the transport itself never makes it false.
	 */
	isAlive(): boolean;
	/**
	 * Every instance that may publish calls this at boot, so no Event is sent before its Consumers
	 * are known. Safe to repeat on any number of instances.
	 */
	consumersSubscribe(consumers: readonly Consumer[]): Promise<void>;
	/** Subscribes, then starts running the Consumers (Worker process only). */
	consumersStart(consumers: readonly Consumer[]): Promise<void>;
	/** `transaction` is the open transaction's client. */
	publisherCreate<M extends Record<string, unknown>>(
		transaction: QueueSql,
	): EventsPublisher<M>;
};

// Every Event names its key; an empty one would put unrelated Events in one line.
const queueEventKeyAssert = (name: string, key: string): void => {
	if (key === "") {
		throw new TypeError(`publish: key must not be empty (Event ${name})`);
	}
};

// The first half of the advisory lock every publish takes on its key ("queu" in ASCII); the second
// half is a hash of the key. Two unrelated keys with one hash only wait for each other.
const queueKeyLockClass = 0x71756575;

// Moves the jobs a publish just wrote to the end of their key's line. pg-boss stamps a job with
// its transaction's start time and breaks a tie by a random id, so without this a transaction
// that began earlier, or two Events in one transaction, could run out of order. The stamp is the
// clock at the publish, or just after the key's last waiting job when the clock has not moved
// past it (a failover to a server whose clock is behind).
const queueJobsStamp = `
	UPDATE queue.job j SET created_on = GREATEST(clock_timestamp(), (
		SELECT max(o.created_on) + interval '1 microsecond' FROM queue.job o
		WHERE o.name = j.name AND o.singleton_key = j.singleton_key AND o.state = 'created'
			AND NOT o.blocked AND o.policy = j.policy AND o.id <> j.id
	))
	WHERE j.name = ANY($1::text[]) AND j.id = ANY($2::uuid[])`;

/**
 * Events on the queue. Each publish writes its jobs on the transaction's client, so they commit or
 * roll back with the rows (outbox). The queue's own publish reads the subscriptions through the
 * pool, which would hold a second connection per transaction; here they are read on the
 * transaction's client, and each subscribed queue gets its job one send at a time (one client runs
 * one query at a time).
 *
 * Order: a publish first takes a lock on its key that lasts until the transaction ends, so two
 * transactions never hold jobs of one key at once, and the one that publishes first commits first.
 * Publish after the write the Event is about: a transaction that publishes before it writes can
 * deadlock with one that writes first, and Postgres then ends one of them.
 */
export const queueEventsCreate = (queue: Queue): Events => {
	const boss = queueBossGet(queue, "queueEventsCreate");
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
				publish: async ({ data, key, name }) => {
					queueEventKeyAssert(name, key);
					const subscribed = await transaction.query(
						"SELECT name FROM queue.subscription WHERE event = $1 ORDER BY name",
						[queueOrderedName(name)],
					);
					const names = (subscribed.rows as { name: string }[]).map(
						(row) => row.name,
					);
					if (names.length === 0) {
						return;
					}
					await transaction.query(
						"SELECT pg_advisory_xact_lock($1, hashtext($2))",
						[queueKeyLockClass, key],
					);
					const ids: (string | null)[] = [];
					for (const queueName of names) {
						ids.push(
							await boss.send(queueName, data as object, {
								db,
								singletonKey: key,
							}),
						);
					}
					await transaction.query(queueJobsStamp, [names, ids]);
				},
			};
		},
	};
};

/** What `queueEventsPublisherMemoryCreate` takes. */
export type QueueEventsPublisherMemoryOptions<M> = {
	/** The array each publish is pushed to as `{ name, data, key }`. Default a new one. */
	// mutable: the publisher pushes each publish to it, so a test reads what was published.
	published?: { name: keyof M; data: unknown; key: string }[] | null;
};

/**
 * The memory twin of the `EventsPublisher` that `queueEventsCreate` hands out: it records each
 * publish in `published` and delivers nothing, so unit tests assert on the array, and a `memory://`
 * URL in development runs on it.
 * `queue-events-publisher.contract.ts` runs the same cases against both.
 */
export const queueEventsPublisherMemoryCreate = <
	M extends Record<string, unknown>,
>(
	options: QueueEventsPublisherMemoryOptions<M> = {},
): EventsPublisher<M> => {
	const published = options.published ?? [];
	return {
		committed: async () => undefined,
		publish: async ({ data, key, name }) => {
			queueEventKeyAssert(name, key);
			published.push({ data, key, name });
		},
	};
};
