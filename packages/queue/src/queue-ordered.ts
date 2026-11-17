import { logger } from "@n8io/baseline-logger";
import { type Gauge, metrics } from "@opentelemetry/api";
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

// The failed Event that holds back `key` for `consumer` (its queueName), if there is one.
const queueOrderedBlockedEventId = async (
	boss: PgBoss,
	{ consumer, key }: { consumer: string; key: string },
): Promise<string | undefined> => {
	const { rows } = await boss
		.getDb()
		.executeSql(
			"SELECT id FROM queue.job WHERE name = $1 AND singleton_key = $2 AND policy = 'key_strict_fifo' AND state = 'failed'",
			[queueOrderedName(consumer), key],
		);
	return (rows as { id: string }[])[0]?.id;
};

// How many jobs a pg-boss command changed: its responses carry `affected`, which its types leave out.
const queueOrderedAffected = (response: unknown): number =>
	(response as { affected?: number }).affected ?? 0;

// Releases a blocked key by running its failed Event again. The Event keeps its place, so it runs
// before the Events waiting behind it. false when the Consumer has no blocked Event for that key.
export const queueOrderedBlockedKeyRetry = async (
	boss: PgBoss,
	blocked: { consumer: string; key: string },
): Promise<boolean> => {
	const id = await queueOrderedBlockedEventId(boss, blocked);
	if (id === undefined) {
		return false;
	}
	const response = await boss.retry(queueOrderedName(blocked.consumer), id);
	return queueOrderedAffected(response) > 0;
};

// Releases a blocked key by deleting its failed Event, so the key moves on without it. The copy in
// `<queueName>.dead` stays. false when the Consumer has no blocked Event for that key. One statement
// that names the failed state, not a lookup then pg-boss's deleteJob: that deletes by id whatever
// the state, so a retry between the two would lose an Event already running again.
export const queueOrderedBlockedKeyGiveUp = async (
	boss: PgBoss,
	{ consumer, key }: { consumer: string; key: string },
): Promise<boolean> => {
	const { rows } = await boss
		.getDb()
		.executeSql(
			"DELETE FROM queue.job WHERE name = $1 AND singleton_key = $2 AND policy = 'key_strict_fifo' AND state = 'failed' RETURNING id",
			[queueOrderedName(consumer), key],
		);
	return rows.length > 0;
};

let blockedKeys: Gauge | undefined;

// Taken on first use, after the telemetry preload has registered the meter provider.
const blockedKeysGauge = (): Gauge => {
	blockedKeys ??= metrics
		.getMeter("@n8io/baseline-queue")
		.createGauge("baseline.queue.blocked_keys", {
			description: "Event keys held back by an Event that failed for good",
			unit: "{key}",
		});
	return blockedKeys;
};

// Looks for blocked keys once a minute in a worker: an Event the queue fails by itself (a dead
// worker or a fetch out of time, five times over) blocks its key with no log line of its own.
// Each blocked key is logged once at error level by every worker that sees it, and the gauge
// carries the count per Consumer until it is back at 0. A check that fails is skipped: the poll
// loops already report a database that is down. Returns what stops the checks.
export const queueOrderedBlockedKeysWatch = (
	boss: PgBoss,
	intervalMs = 60_000,
): (() => void) => {
	const logged = new Set<string>();
	const consumers = new Set<string>();
	const check = async (): Promise<void> => {
		const blocked = await queueOrderedBlockedKeysList(boss);
		const counts = new Map<string, number>();
		const ids = new Set<string>();
		for (const { consumer, key, since } of blocked) {
			counts.set(consumer, (counts.get(consumer) ?? 0) + 1);
			consumers.add(consumer);
			// The key may hold any character, so the pair is told apart by JSON.
			const id = JSON.stringify([consumer, key]);
			ids.add(id);
			if (!logged.has(id)) {
				logged.add(id);
				logger.error(
					{ key, queue: consumer, since },
					"Event key is blocked until released",
				);
			}
		}
		for (const id of logged) {
			if (!ids.has(id)) {
				logged.delete(id);
			}
		}
		for (const consumer of consumers) {
			blockedKeysGauge().record(counts.get(consumer) ?? 0, {
				"messaging.destination.name": consumer,
			});
		}
	};
	const timer = setInterval(() => {
		check().catch(() => undefined);
	}, intervalMs);
	// Never the reason the process stays up.
	timer.unref();
	return () => clearInterval(timer);
};
