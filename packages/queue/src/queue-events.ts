import type pg from "pg";
import { type Queue, queueBoss } from "./queue-create.ts";

export type QueueEvents<M> = {
	publish<K extends keyof M & string>(name: K, data: M[K]): Promise<void>;
};

// pg-boss sends to every subscribed queue at once; one client runs one query at a time, so the
// calls are chained rather than queued inside pg (which warns, and pg 9 removes).
const clientSerialized = (
	pgClient: pg.PoolClient,
): { executeSql: (text: string, values?: unknown[]) => Promise<pg.QueryResult> } => {
	let tail: Promise<unknown> = Promise.resolve();
	return {
		executeSql: (text, values) => {
			const run = tail.then(() => pgClient.query(text, values));
			tail = run.catch(() => undefined);
			return run;
		},
	};
};

// Publishes on the transaction's client, so each job commits or rolls back with the rows (outbox).
export const queueEventsPgBoss = <M extends Record<string, unknown>>(
	queue: Queue,
	pgClient: pg.PoolClient,
): QueueEvents<M> => {
	const boss = queueBoss(queue);
	const db = clientSerialized(pgClient);
	return {
		publish: async (name, data) => {
			await boss.publish(name, data as object, { db });
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
