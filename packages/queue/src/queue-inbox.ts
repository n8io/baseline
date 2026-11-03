import type pg from "pg";
import type { PgBoss } from "pg-boss";
import { queueWithDeadLetterCreate } from "./queue-retry.ts";

// Which consumer handled which event. The use case's transaction port inserts it beside its rows.
export type Inbox = { consumer: string; eventId: string };

export const queueInboxTableCreate =
	"CREATE TABLE IF NOT EXISTS queue.inbox (consumer text NOT NULL, event_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (consumer, event_id))";

// Records the event as handled in the caller's transaction. false = already handled: skip the work,
// commit nothing else and return ok.
export const queueInboxInsert = async (
	pgClient: pg.PoolClient,
	inbox: Inbox,
): Promise<boolean> => {
	const result = await pgClient.query(
		"INSERT INTO queue.inbox (consumer, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
		[inbox.consumer, inbox.eventId],
	);
	return result.rowCount === 1;
};

// The package's own schedule; schedulesRegister never removes names in the `queue.` namespace.
export const queueInboxPruneName = "queue.inbox-prune";

// Daily, in the worker: deletes inbox rows older than 30 days.
export const queueInboxPruneStart = async (boss: PgBoss): Promise<void> => {
	await queueWithDeadLetterCreate(boss, queueInboxPruneName, {
		policy: "exclusive",
	});
	await boss.schedule(queueInboxPruneName, "0 4 * * *", null, {
		missed: "once",
		tz: "UTC",
	});
	await boss.work(queueInboxPruneName, async () => {
		await boss
			.getDb()
			.executeSql(
				"DELETE FROM queue.inbox WHERE created_at < now() - interval '30 days'",
			);
	});
};
