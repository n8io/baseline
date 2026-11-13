import type { PgBoss } from "pg-boss";

// A Consumer's jobs wait in the queue `<queueName>.ordered`, which hands out the jobs of one key
// strictly one after another, and that queue is subscribed to `<eventName>.ordered`. Releases
// before 8 used the bare names for an unordered queue. The two never meet, so a process of such a
// release that is still running in a rollout keeps publishing to its own queue, which this
// release's workers drain too (queueConsumersStart).
export const queueOrderedName = (name: string): string => `${name}.ordered`;

// The keys whose job failed for good, per Consumer. Such a job stays where it failed and holds back
// the later Events of its key until someone releases it (README, "A blocked key").
export const queueOrderedBlockedKeysList = async (
	boss: PgBoss,
): Promise<{ consumer: string; key: string; since: Date }[]> => {
	const { rows } = await boss
		.getDb()
		.executeSql(
			"SELECT name, singleton_key AS key, completed_on AS since FROM queue.job WHERE policy = 'key_strict_fifo' AND state = 'failed' ORDER BY name, singleton_key",
		);
	return (rows as { name: string; key: string; since: Date }[]).map((row) => ({
		consumer: row.name.slice(0, -".ordered".length),
		key: row.key,
		since: row.since,
	}));
};
