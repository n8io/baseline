import { readFileSync } from "node:fs";
import {
	type PostgresPool,
	postgresPoolCreate,
	postgresTransactionRun,
} from "@n8io/baseline-postgres";
import { ok, type Result } from "@n8io/baseline-result";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import {
	type Consumer,
	type Inbox,
	type Queue,
	queueConsumerCreate,
	queueCreate,
	queueEventsCreate,
	queueInboxInsert,
	queueMigrate,
} from "./index.ts";
import { queueBossGet } from "./queue.ts";

type Moved = { key: string; seq: number };
type Events = Record<string, Moved>;

let databaseUrl: string;
let pgPool: PostgresPool;
// Publishes only; each test starts its own workers.
let publisher: Queue;
const closing: AsyncDisposable[] = [];

beforeAll(async () => {
	databaseUrl = await postgresTestDatabaseCreate();
	await queueMigrate({ databaseUrl });
	pgPool = postgresPoolCreate({ databaseUrl });
	await pgPool.query(
		"CREATE TABLE handled (consumer text NOT NULL, key text NOT NULL, seq int NOT NULL, at timestamptz NOT NULL DEFAULT clock_timestamp())",
	);
	publisher = await queueCreate({ pgPool, role: "publisher" });
});

afterAll(async () => {
	for (const resource of closing.reverse()) {
		await resource[Symbol.asyncDispose]();
	}
	await publisher.stop();
	await pgPool.end();
});

const worker = async (max = 4): Promise<Queue> => {
	const workerPool = postgresPoolCreate({ databaseUrl, max });
	const queue = await queueCreate({ pgPool: workerPool, role: "worker" });
	closing.push(workerPool, queue);
	return queue;
};

// A Consumer that records each Event it handles, once, the way a Use case with an inbox does.
// `fail` throws before the commit when it says so.
const consumerCreate = ({
	eventName,
	fail = () => false,
	queueName,
}: {
	eventName: string;
	fail?: (event: Moved) => boolean;
	queueName: string;
}): Consumer =>
	queueConsumerCreate({
		eventName,
		queueName,
		run: (event, inbox: Inbox): Promise<Result<undefined, { type: string }>> =>
			postgresTransactionRun({
				pgPool,
				work: async (pgClient) => {
					if (!(await queueInboxInsert(pgClient, inbox))) {
						return ok(undefined);
					}
					if (fail(event)) {
						throw new Error(`Injected failure for ${event.key} ${event.seq}`);
					}
					await pgClient.query(
						"INSERT INTO handled (consumer, key, seq) VALUES ($1, $2, $3)",
						[queueName, event.key, event.seq],
					);
					return ok(undefined);
				},
			}),
		schema: z.object({ key: z.string(), seq: z.number() }),
	});

const publish = (name: string, events: Moved[]): Promise<unknown> =>
	postgresTransactionRun({
		pgPool,
		work: async (pgClient) => {
			const fooEvents =
				queueEventsCreate(publisher).publisherCreate<Events>(pgClient);
			for (const data of events) {
				await fooEvents.publish({ data, key: data.key, name });
			}
			return ok(undefined);
		},
	});

// The seqs a Consumer handled for one key, in the order it handled them.
const handled = async (consumer: string, key?: string): Promise<number[]> =>
	(
		await pgPool.query<{ seq: number }>(
			"SELECT seq FROM handled WHERE consumer = $1 AND ($2::text IS NULL OR key = $2) ORDER BY at",
			[consumer, key ?? null],
		)
	).rows.map((row) => row.seq);

const handledWait = (consumer: string, count: number): Promise<void> =>
	vi.waitFor(async () => expect(await handled(consumer)).toHaveLength(count), {
		interval: 100,
		timeout: 120_000,
	});

// Retries at once, so a test does not wait out the real delays.
const retryFast = (consumer: string, retryLimit: number): Promise<void> =>
	queueBossGet(publisher).updateQueue(`${consumer}.ordered`, {
		retryBackoff: false,
		retryDelay: 0,
		retryLimit,
	});

describe("order per key", () => {
	it("12 workers keep 2,000 Events over 50 keys in order, each handled once, with a retry on every key", async () => {
		const names = { eventName: "foo.moved", queueName: "ledger.foo-moved" };
		const failedOnce = new Set<string>();
		const consumer = consumerCreate({
			...names,
			// The third Event of every key fails its first attempt.
			fail: ({ key, seq }) => {
				if (seq !== 3 || failedOnce.has(key)) {
					return false;
				}
				failedOnce.add(key);
				return true;
			},
		});
		await queueEventsCreate(publisher).consumersSubscribe([consumer]);
		await retryFast(names.queueName, 4);
		for (let index = 0; index < 12; index += 1) {
			await queueEventsCreate(await worker(3)).consumersStart([consumer]);
		}

		// Each key's Events one after another, each in its own transaction; the keys beside each other.
		await Promise.all(
			Array.from({ length: 50 }, async (_, key) => {
				for (let seq = 1; seq <= 40; seq += 1) {
					await publish(names.eventName, [{ key: `foo_${key}`, seq }]);
				}
			}),
		);
		await handledWait(names.queueName, 2000);

		const early = await pgPool.query(
			`SELECT key, seq FROM (
				SELECT key, seq, max(seq) OVER (PARTITION BY key ORDER BY at ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS before
				FROM handled WHERE consumer = $1
			) ordered WHERE seq < before`,
			[names.queueName],
		);
		expect(early.rows).toEqual([]);
		const distinct = await pgPool.query(
			"SELECT count(DISTINCT (key, seq))::int AS count FROM handled WHERE consumer = $1",
			[names.queueName],
		);
		expect(distinct.rows).toEqual([{ count: 2000 }]);
		expect(failedOnce.size).toBe(50);
	}, 180_000);

	it("one worker drains a single busy key at 20 Events a second or better", async () => {
		const names = { eventName: "foo.busy", queueName: "ledger.foo-busy" };
		const consumer = consumerCreate(names);
		await queueEventsCreate(publisher).consumersSubscribe([consumer]);
		for (let seq = 1; seq <= 300; seq += 10) {
			await publish(
				names.eventName,
				Array.from({ length: 10 }, (_, index) => ({
					key: "foo_busy",
					seq: seq + index,
				})),
			);
		}

		const started = Date.now();
		await queueEventsCreate(await worker()).consumersStart([consumer]);
		await handledWait(names.queueName, 300);

		expect(Date.now() - started).toBeLessThan(15_000);
		expect(await handled(names.queueName)).toEqual(
			Array.from({ length: 300 }, (_, index) => index + 1),
		);
	});
});

describe("order at publish", () => {
	const names = { eventName: "foo.renamed", queueName: "search.foo-renamed" };
	const consumer = consumerCreate(names);
	// Runs the Consumer only once the Events are committed, so only their stamps decide the order.
	const drained = async (key: string, count: number): Promise<number[]> => {
		await vi.waitFor(
			async () =>
				expect(await handled(names.queueName, key)).toHaveLength(count),
			{ interval: 100, timeout: 30_000 },
		);
		return handled(names.queueName, key);
	};

	beforeAll(async () => {
		await queueEventsCreate(publisher).consumersSubscribe([consumer]);
	});

	it("two overlapping transactions on one key arrive in commit order, not in start order", async () => {
		const events = queueEventsCreate(publisher);
		const first = await pgPool.connect();
		const second = await pgPool.connect();
		try {
			// `first` starts first, but `second` changes the entity and commits first.
			await first.query("BEGIN");
			await first.query("SELECT now()");
			await second.query("BEGIN");
			await events.publisherCreate<Events>(second).publish({
				data: { key: "foo_a", seq: 1 },
				key: "foo_a",
				name: names.eventName,
			});
			await second.query("COMMIT");
			await events.publisherCreate<Events>(first).publish({
				data: { key: "foo_a", seq: 2 },
				key: "foo_a",
				name: names.eventName,
			});
			await first.query("COMMIT");
		} finally {
			first.release();
			second.release();
		}

		await queueEventsCreate(await worker()).consumersStart([consumer]);

		expect(await drained("foo_a", 2)).toEqual([1, 2]);
	});

	it("a publish waits for another transaction's publish on its key, and not for other keys", async () => {
		const events = queueEventsCreate(publisher);
		const first = await pgPool.connect();
		const second = await pgPool.connect();
		try {
			await first.query("BEGIN");
			await events.publisherCreate<Events>(first).publish({
				data: { key: "foo_b", seq: 1 },
				key: "foo_b",
				name: names.eventName,
			});
			await second.query("BEGIN");
			await events.publisherCreate<Events>(second).publish({
				data: { key: "foo_c", seq: 1 },
				key: "foo_c",
				name: names.eventName,
			});
			let published = false;
			const waiting = events
				.publisherCreate<Events>(second)
				.publish({
					data: { key: "foo_b", seq: 2 },
					key: "foo_b",
					name: names.eventName,
				})
				.then(() => {
					published = true;
				});
			await new Promise((resolve) => setTimeout(resolve, 500));
			expect(published).toBe(false);

			await first.query("COMMIT");
			await waiting;
			await second.query("COMMIT");
		} finally {
			first.release();
			second.release();
		}

		expect(await drained("foo_b", 2)).toEqual([1, 2]);
	});

	it("Events of one key in one transaction keep their publish order", async () => {
		await publish(
			names.eventName,
			Array.from({ length: 8 }, (_, index) => ({
				key: "foo_d",
				seq: index + 1,
			})),
		);

		expect(await drained("foo_d", 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});

	it("an Event sorts after its key's waiting Events when the clock is behind them", async () => {
		// A worker that never succeeds on this key keeps both Events waiting.
		const held = consumerCreate({
			eventName: "foo.held",
			queueName: "search.foo-held",
		});
		await queueEventsCreate(publisher).consumersSubscribe([held]);
		await publish("foo.held", [{ key: "foo_e", seq: 1 }]);
		// As after a failover to a server whose clock is an hour behind.
		await pgPool.query(
			"UPDATE queue.job SET created_on = now() + interval '1 hour' WHERE name = 'search.foo-held.ordered'",
		);
		await publish("foo.held", [{ key: "foo_e", seq: 2 }]);

		await queueEventsCreate(await worker()).consumersStart([held]);
		await handledWait("search.foo-held", 2);

		expect(await handled("search.foo-held")).toEqual([1, 2]);
	});

	it("refuses an empty key", async () => {
		await expect(
			publish(names.eventName, [{ key: "", seq: 1 }]),
		).rejects.toThrow("Event foo.renamed needs a key");
	});
});

describe("a blocked key", () => {
	// The statements an operator runs, taken from the README so the runbook is what is tested.
	const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
	const release = (verb: "UPDATE" | "DELETE", key: string): string => {
		const statement = new RegExp(`^${verb}[^;]+;`, "m").exec(readme)?.[0];
		if (statement === undefined) {
			throw new Error(`The README has no ${verb} statement`);
		}
		return statement
			.replace("billing.order-placed.ordered", "audit.foo-poisoned.ordered")
			.replace("order_123", key);
	};

	it("a poison Event blocks only its key, shows in blockedKeys(), and each documented release unblocks it", async () => {
		const names = {
			eventName: "foo.poisoned",
			queueName: "audit.foo-poisoned",
		};
		let poisoned = true;
		const consumer = consumerCreate({
			...names,
			fail: ({ key, seq }) => poisoned && key !== "foo_fine" && seq === 2,
		});
		const queue = await worker();
		await queueEventsCreate(queue).consumersStart([consumer]);
		await retryFast(names.queueName, 1);

		const before = new Date();
		for (const seq of [1, 2, 3]) {
			await publish(names.eventName, [
				{ key: "foo_poison", seq },
				{ key: "foo_fine", seq },
			]);
		}
		await vi.waitFor(
			async () =>
				expect(await queue.blockedKeys()).toEqual([
					{
						consumer: names.queueName,
						key: "foo_poison",
						since: expect.any(Date),
					},
				]),
			{ interval: 100, timeout: 30_000 },
		);
		const [blocked] = await queue.blockedKeys();
		expect(blocked?.since.getTime()).toBeGreaterThanOrEqual(
			before.getTime() - 1000,
		);
		await handledWait(names.queueName, 4);
		expect(await handled(names.queueName, "foo_fine")).toEqual([1, 2, 3]);
		expect(await handled(names.queueName, "foo_poison")).toEqual([1]);
		const boss = queueBossGet(queue);
		expect(await boss.findJobs("audit.foo-poisoned.dead")).toHaveLength(1);

		// Fixed and deployed: run it again. It runs before the Event waiting behind it.
		poisoned = false;
		const retried = await pgPool.query(release("UPDATE", "foo_poison"));
		expect(retried.rowCount).toBe(1);
		await handledWait(names.queueName, 6);
		expect(await handled(names.queueName, "foo_poison")).toEqual([1, 2, 3]);
		expect(await queue.blockedKeys()).toEqual([]);

		// Or give it up: the key moves on without it.
		poisoned = true;
		for (const seq of [1, 2, 3]) {
			await publish(names.eventName, [{ key: "foo_given_up", seq }]);
		}
		await vi.waitFor(
			async () =>
				expect((await queue.blockedKeys()).map((key) => key.key)).toEqual([
					"foo_given_up",
				]),
			{ interval: 100, timeout: 30_000 },
		);
		const discarded = await pgPool.query(release("DELETE", "foo_given_up"));
		expect(discarded.rowCount).toBe(1);
		await handledWait(names.queueName, 8);
		expect(await handled(names.queueName, "foo_given_up")).toEqual([1, 3]);
		expect(await queue.blockedKeys()).toEqual([]);
		expect(await boss.findJobs("audit.foo-poisoned.dead")).toHaveLength(2);
	});

	it("the README's listing is what blockedKeys() reads", () => {
		expect(readme).toContain(
			"SELECT name, singleton_key AS key, completed_on AS since\nFROM queue.job WHERE policy = 'key_strict_fifo' AND state = 'failed';",
		);
	});
});
