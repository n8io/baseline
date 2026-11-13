// The queue and Events for a composition root, in the same Postgres as the Domains: both "memory"
// with a memory database. `pnpm piece-remove queue` deletes this file.
import type { PostgresPool } from "@n8io/baseline-postgres";
import { type Events, type Queue, queueCreate } from "@n8io/baseline-queue";
import type { ShutdownStep } from "@n8io/baseline-shutdown";
import { eventsOpen } from "./events-open.ts";

// The queue stops at shutdown before what is already in its steps: the Worker's intakes, since it
// brings work in there, else the resources.
export const queueOpen = async ({
	database,
	intakes,
	resources,
	role,
}: {
	database: PostgresPool | "memory";
	intakes: ShutdownStep[];
	resources: ShutdownStep[];
	role: "publisher" | "worker";
}): Promise<{ events: Events | "memory"; queue: Queue | "memory" }> => {
	if (database === "memory") return { events: "memory", queue: "memory" };
	const queue = await queueCreate({ pgPool: database, role });
	(role === "worker" ? intakes : resources).unshift({
		close: () => queue.stop(),
		name: "queue",
	});
	return { events: eventsOpen({ intakes, queue, resources, role }), queue };
};
