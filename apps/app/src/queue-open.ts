// The queue and Events for an entry point, in the same Postgres as the contexts: both "memory"
// with a memory database. `pnpm piece-remove queue` deletes this file.
import type { PostgresPool } from "@n8io/baseline-postgres";
import { type Events, type Queue, queueCreate } from "@n8io/baseline-queue";
import { eventsOpen } from "./events-open.ts";
import { resourceOpen, type ShutdownSteps } from "./shutdown-step-add.ts";

// The steps it returns close the queue at shutdown before what is already in them: the Worker's
// intakes, since it brings work in there, else the resources.
export const queueOpen = async ({
	database,
	poolMax,
	role,
	steps,
}: {
	database: PostgresPool | "memory";
	// The pool's size, from databaseOpen.
	poolMax: number;
	role: "publisher" | "worker";
	steps: ShutdownSteps;
}): Promise<{
	events: Events | "memory";
	queue: Queue | "memory";
	steps: ShutdownSteps;
}> => {
	if (database === "memory") {
		return { events: "memory", queue: "memory", steps };
	}
	const queue = await queueCreate({
		// A Worker runs this many Events and Schedule runs at once, across all its Event handlers. Each
		// holds a pool connection while it runs, so one is kept free for the queue's own polls.
		concurrency: Math.max(1, poolMax - 1),
		pgPool: database,
		role,
	});
	return {
		events: eventsOpen(queue),
		queue,
		steps: resourceOpen({
			at: "first",
			group: role === "worker" ? "intakes" : "resources",
			name: "queue",
			resource: queue,
			steps,
		}),
	};
};
