import type pg from "pg";
import { type Queue, queueBossGet } from "./queue-create.ts";

export type QueueEvents<M> = {
	publish<K extends keyof M & string>(name: K, data: M[K]): Promise<void>;
};

// Publishes on the transaction's client, so each job commits or rolls back with the rows (outbox).
// pg-boss's own publish() reads the subscriptions through the pool, which would hold a second
// connection per transaction; here they are read on the transaction's client, and each subscribed
// queue gets its job one send at a time (one client runs one query at a time).
export const queueEventsPgBoss = <M extends Record<string, unknown>>(
	queue: Queue,
	pgClient: pg.PoolClient,
): QueueEvents<M> => {
	const boss = queueBossGet(queue);
	const db = {
		executeSql: (text: string, values?: unknown[]): Promise<pg.QueryResult> =>
			pgClient.query(text, values),
	};
	return {
		publish: async (name, data) => {
			const subscribed = await pgClient.query<{ name: string }>(
				"SELECT name FROM queue.subscription WHERE event = $1 ORDER BY name",
				[name],
			);
			for (const { name: queueName } of subscribed.rows) {
				await boss.send(queueName, data as object, { db });
			}
		},
	};
};

// Records publishes in `published` and delivers nothing; unit tests assert on the array.
export const queueEventsMemory = <M extends Record<string, unknown>>(
	published: { name: keyof M; data: unknown }[] = [],
): QueueEvents<M> => ({
	publish: async (name, data) => {
		published.push({ data, name });
	},
});
