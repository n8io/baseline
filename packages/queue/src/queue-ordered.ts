import { logger } from "@n8io/baseline-logger";
import { type Counter, type Gauge, metrics } from "@opentelemetry/api";
import type { PgBoss } from "pg-boss";

// A Consumer's jobs wait in the queue `<queueName>.ordered`, which hands out the jobs of one key
// strictly one after another, and that queue is subscribed to `<eventName>.ordered`. Releases
// before 8 used the bare names for an unordered queue. The two never meet, so a process of such a
// release that is still running in a rollout keeps publishing to its own queue, which this
// release's workers drain too (queueConsumersStart).
export const queueOrderedName = (name: string): string => `${name}.ordered`;

// The keys whose job failed for good, per Consumer. Such a job stays where it failed and holds back
// the later Events of its key until someone releases it (README, "A blocked key"). `deleteAt` is
// when the queue's own deletion time runs out and it deletes the job, so the key moves on without
// it; `waiting` counts the Events of the key held back behind it.
const queueOrderedBlockedKeysRead = async (
	boss: PgBoss,
): Promise<
	{
		consumer: string;
		deleteAt: Date;
		key: string;
		since: Date;
		waiting: number;
	}[]
> => {
	const { rows } = await boss
		.getDb()
		.executeSql(
			"SELECT j.name, j.singleton_key AS key, j.completed_on AS since, j.completed_on + j.deletion_seconds * interval '1s' AS delete_at, (SELECT count(*)::int FROM queue.job w WHERE w.name = j.name AND w.singleton_key = j.singleton_key AND w.state IN ('created', 'retry')) AS waiting FROM queue.job j WHERE j.policy = 'key_strict_fifo' AND j.state = 'failed' ORDER BY j.name, j.singleton_key",
		);
	return (
		rows as {
			delete_at: Date;
			key: string;
			name: string;
			since: Date;
			waiting: number;
		}[]
	).map((row) => ({
		consumer: row.name.slice(0, -".ordered".length),
		deleteAt: row.delete_at,
		key: row.key,
		since: row.since,
		waiting: row.waiting,
	}));
};

export const queueOrderedBlockedKeysList = async (
	boss: PgBoss,
): Promise<{ consumer: string; deleteAt: Date; key: string; since: Date }[]> =>
	(await queueOrderedBlockedKeysRead(boss)).map(
		({ consumer, deleteAt, key, since }) => ({
			consumer,
			deleteAt,
			key,
			since,
		}),
	);

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

// What error tracking groups a blocked key under. Its message names no key and no Event data (they
// go in log fields), so all blocked keys of a Consumer land in one issue.
class QueueBlockedKeyError extends Error {
	override readonly name = "QueueBlockedKeyError";
	constructor() {
		super("An Event key is blocked until released");
	}
}

// A blocked key the queue let go by itself: its failed Event outlived the queue's deletion time.
class QueueBlockedKeyExpiredError extends Error {
	override readonly name = "QueueBlockedKeyExpiredError";
	constructor() {
		super(
			"A blocked Event was deleted unreleased; its key moved on without it",
		);
	}
}

type QueueOrderedInstruments = {
	age: Gauge;
	expired: Counter;
	keys: Gauge;
	waiting: Gauge;
};

let instruments: QueueOrderedInstruments | undefined;

// Taken on first use, after the telemetry preload has registered the meter provider.
const queueOrderedInstrumentsGet = (): QueueOrderedInstruments => {
	if (instruments === undefined) {
		const meter = metrics.getMeter("@n8io/baseline-queue");
		instruments = {
			age: meter.createGauge("baseline.queue.blocked_key_age", {
				description: "Age of the oldest blocked Event key",
				unit: "s",
			}),
			expired: meter.createCounter("baseline.queue.blocked_keys_expired", {
				description:
					"Blocked Event keys the queue let go by deleting their failed Event unreleased",
				unit: "{key}",
			}),
			keys: meter.createGauge("baseline.queue.blocked_keys", {
				description: "Event keys held back by an Event that failed for good",
				unit: "{key}",
			}),
			waiting: meter.createGauge("baseline.queue.blocked_key_waiting", {
				description: "Events waiting behind blocked Event keys",
				unit: "{event}",
			}),
		};
	}
	return instruments;
};

const dayMs = 86_400_000;

// Looks for blocked keys once a minute in a worker: an Event the queue fails by itself (a dead
// worker or a fetch out of time, five times over) blocks its key with no log line of its own.
// Every worker that sees a blocked key logs it at error level with an err, so it reaches error
// tracking, and again each day it stays blocked. From a day before the queue deletes its failed
// Event it also warns with that time, and once the queue has deleted it, it logs at error and counts
// it. A key released by retry or give-up before then logs nothing more. Per Consumer, gauges carry
// the count, the oldest one's age and the Events waiting behind them until they are back at 0. A
// check that fails is skipped: the poll loops already report a database that is down. `remindMs`
// (a day) is both the repeat and the warning's lead; tests shorten it. Returns what stops the checks.
export const queueOrderedBlockedKeysWatch = (
	boss: PgBoss,
	timing?: { checkMs?: number | null; remindMs?: number | null } | null,
): (() => void) => {
	const checkMs = timing?.checkMs ?? 60_000;
	const remindMs = timing?.remindMs ?? dayMs;
	const tracked = new Map<
		string,
		{
			consumer: string;
			deleteAt: Date;
			key: string;
			loggedAt: number;
			warned: boolean;
		}
	>();
	const consumers = new Set<string>();
	const check = async (): Promise<void> => {
		const blocked = await queueOrderedBlockedKeysRead(boss);
		const now = Date.now();
		const totals = new Map<
			string,
			{ count: number; oldest: number; waiting: number }
		>();
		const seen = new Set<string>();
		for (const { consumer, deleteAt, key, since, waiting } of blocked) {
			consumers.add(consumer);
			const total = totals.get(consumer) ?? {
				count: 0,
				oldest: now,
				waiting: 0,
			};
			totals.set(consumer, {
				count: total.count + 1,
				oldest: Math.min(total.oldest, since.getTime()),
				waiting: total.waiting + waiting,
			});
			// The key may hold any character, so the pair is told apart by JSON.
			const id = JSON.stringify([consumer, key]);
			seen.add(id);
			// A new deadline is a new failure (released, then failed again between two checks).
			const known = tracked.get(id);
			const entry =
				known?.deleteAt.getTime() === deleteAt.getTime()
					? known
					: { consumer, deleteAt, key, loggedAt: -Infinity, warned: false };
			tracked.set(id, entry);
			const fields = { deleteAt, key, queue: consumer, since };
			if (now - entry.loggedAt >= remindMs) {
				entry.loggedAt = now;
				logger.error(
					{ ...fields, err: new QueueBlockedKeyError() },
					"Event key is blocked until released",
				);
			}
			if (!entry.warned && deleteAt.getTime() - now <= remindMs) {
				entry.warned = true;
				logger.warn(
					fields,
					"Event key is blocked, and its failed Event is deleted at deleteAt unless released first",
				);
			}
		}
		const { age, expired, keys, waiting } = queueOrderedInstrumentsGet();
		for (const [id, entry] of tracked) {
			if (seen.has(id)) {
				continue;
			}
			tracked.delete(id);
			if (now >= entry.deleteAt.getTime()) {
				logger.error(
					{
						deleteAt: entry.deleteAt,
						err: new QueueBlockedKeyExpiredError(),
						key: entry.key,
						queue: entry.consumer,
					},
					"Blocked Event was deleted unreleased; its key moved on without it",
				);
				expired.add(1, { "messaging.destination.name": entry.consumer });
			}
		}
		for (const consumer of consumers) {
			const total = totals.get(consumer);
			const attributes = { "messaging.destination.name": consumer };
			keys.record(total?.count ?? 0, attributes);
			age.record(
				total === undefined ? 0 : Math.round((now - total.oldest) / 1000),
				attributes,
			);
			waiting.record(total?.waiting ?? 0, attributes);
		}
	};
	const timer = setInterval(() => {
		check().catch(() => undefined);
	}, checkMs);
	// Never the reason the process stays up.
	timer.unref();
	return () => clearInterval(timer);
};
