import { spawn } from "node:child_process";
import { once } from "node:events";
import { postgresPoolCreate } from "@n8io/baseline-postgres";
import {
	queueConsumerCreate,
	queueCreate,
	queueEventsCreate,
} from "@n8io/baseline-queue";
import { ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { integrationDatabaseCreate } from "./integration-database.ts";

// `pnpm blocked-keys [retry|give-up <consumer> <key>]`, through the preload as in a pod.
const blockedKeysRun = async (
	databaseUrl: string,
	args: string[],
): Promise<{ code: number | null; output: string }> => {
	const child = spawn(
		"node",
		["--import", "./src/preload.ts", "src/blocked-keys.ts", ...args],
		{
			env: {
				...process.env,
				APP_ENV: "development",
				CACHE_URL: "memory://",
				DATABASE_URL: databaseUrl,
				// With an OTLP endpoint and no collector, the last export holds the exit for seconds.
				OTEL_LOGS_EXPORTER: "none",
				OTEL_METRICS_EXPORTER: "none",
				OTEL_TRACES_EXPORTER: "none",
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let output = "";
	child.stdout.on("data", (chunk) => {
		output += chunk;
	});
	child.stderr.on("data", (chunk) => {
		output += chunk;
	});
	const [code] = await once(child, "exit");
	return { code: code as number | null, output };
};

describe("src/blocked-keys.ts on Postgres", { timeout: 60_000 }, () => {
	it("lists a blocked key, releases it with retry or give-up, and exits 1 when nothing was released", async () => {
		await using database = await integrationDatabaseCreate();
		await using pgPool = postgresPoolCreate({
			databaseUrl: database.databaseUrl,
		});
		await using queue = await queueCreate({ pgPool, role: "publisher" });
		const events = queueEventsCreate(queue);
		await events.consumersSubscribe([
			queueConsumerCreate({
				eventName: "sample.blocked",
				queueName: "audit.sample-blocked",
				run: async () => ok(undefined),
				schema: z.object({}),
			}),
		]);
		// No Worker runs here, so the Event waits; failing it by hand blocks its key.
		const block = async (): Promise<void> => {
			await pgPool.query(
				"UPDATE queue.job SET state = 'failed', completed_on = now() WHERE name = 'audit.sample-blocked.ordered'",
			);
		};
		const pgClient = await pgPool.connect();
		try {
			await events
				.publisherCreate<{ "sample.blocked": Record<string, never> }>(pgClient)
				.publish({ data: {}, key: "sample_1", name: "sample.blocked" });
		} finally {
			pgClient.release();
		}
		await block();
		const { databaseUrl } = database;

		const listed = await blockedKeysRun(databaseUrl, []);
		expect(listed.code).toBe(0);
		expect(listed.output).toContain("audit.sample-blocked");
		expect(listed.output).toContain("sample_1");

		const wrong = ["retry", "audit.sample-blocked", "sample_2"];
		expect((await blockedKeysRun(databaseUrl, wrong)).code).toBe(1);
		expect(await queue.blockedKeys()).toHaveLength(1);
		expect(
			(
				await blockedKeysRun(databaseUrl, [
					"skip",
					"audit.sample-blocked",
					"sample_1",
				])
			).code,
		).toBe(1);

		const blocked = ["audit.sample-blocked", "sample_1"];
		expect(
			(await blockedKeysRun(databaseUrl, ["retry", ...blocked])).code,
		).toBe(0);
		expect(await queue.blockedKeys()).toEqual([]);

		await block();
		expect(
			(await blockedKeysRun(databaseUrl, ["give-up", ...blocked])).code,
		).toBe(0);
		expect(await queue.blockedKeys()).toEqual([]);
		expect(
			(await blockedKeysRun(databaseUrl, ["give-up", ...blocked])).code,
		).toBe(1);
	});

	it("exits 1 on a memory database, which has no queue", async () => {
		expect((await blockedKeysRun("memory://", [])).code).toBe(1);
	});
});
